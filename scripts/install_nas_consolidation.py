import json,pathlib,subprocess
base=pathlib.Path('/volume1/docker/Files/kindred/deploy/ugreen/data/consolidation')
config=dict(state_dir=str(base),library='/volume1/Family/Photos',staging=['/volume1/Family/_takeout/Jen','/volume1/Family/_takeout/Michael'],discovery_status='/volume1/docker/Files/kindred/deploy/ugreen/data/backend/nas-discovery-status.json',heartbeat='/tmp/kindred-consolidation-heartbeat.json',resend_env=str(base/'resend.env'),email='mkteagle@gmail.com')
(base/'config.json').write_text(json.dumps(config,indent=2))
unitdir=pathlib.Path.home()/'.config/systemd/user';unitdir.mkdir(parents=True,exist_ok=True)
for name,extra in [('kindred-consolidation',''),('kindred-consolidation-watch',' --watch')]:
    (unitdir/(name+'.service')).write_text(f'''[Unit]
Description=Kindred NAS {'alert watchdog' if extra else 'verified Takeout cleanup'}
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 {base}/nas_consolidate.py --config {base}/config.json{extra}
Restart=on-failure
RestartSec=60
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
UMask=0077

[Install]
WantedBy=default.target
''')
print('user_unit_directory='+str(unitdir))
subprocess.run(['systemctl','--user','daemon-reload'],check=True)
subprocess.run(['systemctl','--user','enable','--now','kindred-consolidation.service','kindred-consolidation-watch.service'],check=True)
subprocess.run(['systemctl','--user','is-active','kindred-consolidation.service','kindred-consolidation-watch.service'],check=True)
