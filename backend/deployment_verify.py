"""Smoke-test the running API after image recreation without exposing its API key."""
import json
import os
import urllib.request


def get(path):
    request = urllib.request.Request('http://127.0.0.1:8000' + path,
                                    headers={'X-API-Key': os.environ['API_KEY']})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.headers.get('Content-Type', ''), response.read()


def main():
    _, health = get('/health')
    assert json.loads(health)['status'] == 'ok'
    _, counts = get('/library/counts')
    counts = json.loads(counts)
    _, body = get('/library/photos?limit=1')
    page = json.loads(body)
    if counts['photos'] and not page['photos']:
        raise RuntimeError('Gallery is empty despite catalog photos')
    if page['photos']:
        kind, image = get('/photos/' + page['photos'][0]['photo_id'] + '/image?size=h')
        if not kind.startswith('image/') or not image:
            raise RuntimeError('Gallery preview did not return an image')
    print(json.dumps({'health': 'ok', 'gallery': 'ok', 'counts': counts}))


if __name__ == '__main__':
    main()
