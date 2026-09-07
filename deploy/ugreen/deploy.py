#!/usr/bin/env python3
"""Deploy one exact Git revision on the NAS; never copy source into containers."""
from __future__ import annotations
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RUNTIME = Path('/volume1/docker/Files/kindred/deploy/ugreen')
SERVICES = ('api', 'web', 'library-worker', 'video-worker')


def run(*args, capture=False, cwd=None):
    result = subprocess.run([str(a) for a in args], cwd=cwd, check=True,
                            text=True, stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else None


def restore(target, runtime, active):
    if 'library-worker' in active['services']:
        # An older image may only understand the JSON snapshot. Stop the writer,
        # then use the active image to export all journaled receipts under its lock.
        active_config = Path(active['config'])
        compose(active_config, runtime, 'stop', 'library-worker')
        compact_code = """import importlib.util, os
from pathlib import Path
path = Path(os.environ.get('KINDRED_WORKER_DATA', '/app/data')) / 'staged-import-progress.json'
if importlib.util.find_spec('import_checkpoint') is not None:
    import import_checkpoint
    import_checkpoint.compact(path)
else:
    journal = Path(str(path) + '.journal')
    if journal.exists() and journal.stat().st_size:
        raise RuntimeError('Active image cannot compact the import journal; refusing unsafe rollback')
"""
        compose(active_config, runtime, 'run', '--rm', '--no-deps', '--entrypoint',
                'python', 'library-worker', '-c', compact_code)
    extras = sorted(set(active['services']) - set(target['services']))
    if extras:
        compose(Path(active['config']), runtime, 'stop', *extras)
    compose(Path(target['config']), runtime, 'up', '-d', '--no-deps', '--no-build',
            '--force-recreate', '--wait', '--wait-timeout', '300', *target['services'])


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def render(template, source, data, revision):
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('Deployment requires a full Git commit SHA')
    for path in (source, data):
        if any(c in str(path) for c in '\n\r$\"'):
            raise ValueError('Deployment paths cannot contain newlines, dollar signs or quotes')
    values = {'KINDRED_SOURCE_ROOT': str(source), 'KINDRED_DATA_ROOT': str(data),
              'KINDRED_REVISION': revision}
    for key, value in values.items():
        template = re.sub(r'\$\{' + key + r'(?::\?[^}]*)?\}', lambda _: value, template)
    return template


def compose(config, runtime, *args, capture=False):
    return run('docker', 'compose', '--project-name', 'kindred', '--project-directory', runtime,
               '--env-file', runtime / '.env', '-f', config, *args, capture=capture)


def inspect_container(name):
    return json.loads(run('docker', 'inspect', name, capture=True))[0]


def verify(config, runtime, revision, services):
    images = {}
    for service in services:
        container = inspect_container('kindred-' + service + '-1')
        image_id = container['Image']
        image = json.loads(run('docker', 'image', 'inspect', image_id, capture=True))[0]
        actual = (image['Config'].get('Labels') or {}).get('org.opencontainers.image.revision')
        if actual != revision:
            raise RuntimeError(f'{service}: running image revision {actual!r} differs from {revision}')
        state = container['State']
        if not state.get('Running') and not (service == 'library-worker' and state.get('ExitCode') == 0):
            raise RuntimeError(f'{service}: container is not running: {state.get("Status")}')
        health = state.get('Health', {}).get('Status')
        if health and health != 'healthy':
            raise RuntimeError(f'{service}: health is {health}')
        images[service] = image_id
    if 'api' in services:
        compose(config, runtime, 'exec', '-T', 'api', 'python', '/app/deployment_verify.py')
    return images


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('deploy', 'rollback', 'status'), nargs='?', default='deploy')
    parser.add_argument('--ref', default='origin/main', help='Branch/ref to resolve to one exact commit')
    parser.add_argument('--runtime', type=Path, default=DEFAULT_RUNTIME)
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    state_dir = runtime / 'data' / 'deployments'
    state_dir.mkdir(parents=True, exist_ok=True)
    current = state_dir / 'current.json'
    if args.action == 'status':
        print(current.read_text() if current.exists() else 'No Git deployment recorded yet.')
        run('docker', 'ps', '-a', '--filter', 'label=com.docker.compose.project=kindred',
            '--format', '{{.Names}}\t{{.Image}}\t{{.Status}}')
        return 0
    if not (runtime / '.env').is_file():
        raise RuntimeError(f'Missing existing production environment: {runtime / ".env"}')
    with (state_dir / 'deploy.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another Kindred deployment is running')
        if args.action == 'rollback':
            previous = state_dir / 'previous.json'
            if not previous.exists():
                raise RuntimeError('No previous deployment is recorded')
            target = json.loads(previous.read_text())
            config = Path(target['config'])
            services = target['services']
            active = json.loads(current.read_text()) if current.exists() else target
            restore(target, runtime, active)
            if target.get('revision'):
                verify(config, runtime, target['revision'], services)
            old = json.loads(current.read_text()) if current.exists() else None
            write_json(current, target)
            if old:
                write_json(previous, old)
            shutil.copy2(config, runtime / 'docker-compose.yaml')
            print('Rolled back to ' + (target.get('revision') or 'the previous NAS deployment'))
            return 0

        launcher_before = Path(__file__).read_bytes()
        if run('git', 'status', '--porcelain', capture=True, cwd=ROOT):
            raise RuntimeError('NAS Git checkout has local changes; commit or preserve them before deploying')
        run('git', 'fetch', '--prune', 'origin', cwd=ROOT)
        revision = run('git', 'rev-parse', '--verify', args.ref + '^{commit}', capture=True, cwd=ROOT)
        if args.ref == 'origin/main':
            run('git', 'merge', '--ff-only', revision, cwd=ROOT)
            if Path(__file__).read_bytes() != launcher_before:
                # A fetched release may change deployment services or verification.
                # Release this process's lock and execute the updated launcher.
                fcntl.flock(lock, fcntl.LOCK_UN)
                os.execv(sys.executable, [sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]])
        release = state_dir / 'releases' / revision
        if not release.exists():
            release.parent.mkdir(parents=True, exist_ok=True)
            run('git', 'worktree', 'add', '--detach', release, revision, cwd=ROOT)
        actual = run('git', 'rev-parse', 'HEAD', capture=True, cwd=release)
        if actual != revision or run('git', 'status', '--porcelain', capture=True, cwd=release):
            raise RuntimeError('Release checkout is not clean at the requested commit')
        config_dir = state_dir / 'configs'
        config_dir.mkdir(exist_ok=True)
        config = config_dir / (revision + '.yaml')
        config.write_text(render((release / 'deploy/ugreen/docker-compose.release.yml').read_text(),
                                 release, runtime / 'data', revision))
        compose(config, runtime, 'config', '--quiet')
        services = list(SERVICES)
        build_services = sorted({'api' if service in ('library-worker', 'video-worker') else service for service in services})
        print(f'Building Git commit {revision}', flush=True)
        compose(config, runtime, 'build', *build_services)
        if current.exists():
            previous = json.loads(current.read_text())
        else:
            legacy = runtime / 'docker-compose.yaml'
            legacy_snapshot = config_dir / 'before-git-deployment.yaml'
            if not legacy.exists():
                raise RuntimeError('Existing NAS Compose file is required for first-deployment rollback')
            shutil.copy2(legacy, legacy_snapshot)
            legacy_services = compose(legacy_snapshot, runtime, 'config', '--services', capture=True).splitlines()
            previous = {'revision': None, 'config': str(legacy_snapshot),
                        'services': [service for service in services if service in legacy_services]}
        write_json(state_dir / 'previous.json', previous)
        # Builds finish before any running service is touched. Never run `down`,
        # remove volumes, restart the database, or operate on another project.
        try:
            compose(config, runtime, 'up', '-d', '--no-deps', '--no-build', '--force-recreate',
                    '--wait', '--wait-timeout', '300', *services)
            image_ids = verify(config, runtime, revision, services)
        except Exception:
            print('Verification failed; restoring the previous application containers.', flush=True)
            restore(previous, runtime, {'config': str(config), 'services': services})
            raise
        record = {'revision': revision, 'config': str(config), 'services': services,
                  'image_ids': image_ids, 'deployed_at': dt.datetime.now(dt.timezone.utc).isoformat()}
        write_json(current, record)
        shutil.copy2(config, runtime / 'docker-compose.yaml')
        print(f'Verified deployment: {revision}', flush=True)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, subprocess.CalledProcessError) as exc:
        print(f'Deployment failed: {exc}', file=sys.stderr)
        print('Existing data is preserved. Inspect status or run the rollback command.', file=sys.stderr)
        raise SystemExit(1)
