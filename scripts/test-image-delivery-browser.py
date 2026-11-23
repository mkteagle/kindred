"""Browser request regression using synthetic API responses; see docs/image-delivery.md."""
import asyncio, json, os, sys
from io import BytesIO
from urllib.parse import urlparse, parse_qs
from PIL import Image
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, executable_path=os.environ.get('CHROME_PATH', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'))
        context = await browser.new_context(viewport={'width':1280, 'height':800}, device_scale_factor=2)
        await context.add_cookies([{'name':'kindred_session', 'value':'fixture', 'url':'http://localhost:3109'}])
        page = await context.new_page()
        requests=[]; errors=[]
        expired_requests = 0
        remount_requests = 0
        hold_returning_thumbnail = False
        release_thumbnail = asyncio.Event()
        selected_id = None
        release_preview = asyncio.Event()
        page.on('pageerror', lambda error: errors.append(str(error)))
        photos=[dict(photo_id=str(i), photo_title=f'Photo {i}', date_taken='2026-08-20T12:00:00', media_kind='photo', duration_seconds=None) for i in range(200)]
        async def api(route):
            nonlocal expired_requests, remount_requests
            url=route.request.url; path=urlparse(url).path
            if path == '/api/fixture/expired-thumbnail':
                expired_requests += 1
                return await route.fulfill(status=403, headers={'Cache-Control': 'no-store'})
            if path.endswith('/image'):
                if hold_returning_thumbnail and path.endswith('/photos/0/image'):
                    remount_requests += 1
                    await release_thumbnail.wait()
                query=parse_qs(urlparse(url).query); width=int(query.get('w',['4000'])[0]); requests.append(url)
                if path.endswith(f'/photos/{selected_id}/image') and query.get('format') == ['jpeg']:
                    await release_preview.wait()
                if os.environ.get('LEGACY_BACKEND') == '1':
                    width = 512 if query.get('size') == ['n'] else 2048
                ratio = 2 if os.environ.get('PORTRAIT') == '1' and '/photos/20/image' in path else .75
                output=BytesIO(); Image.new('RGB',(width,round(width*ratio)), '#946d52').save(output,'WEBP')
                await asyncio.sleep(.05)
                return await route.fulfill(body=output.getvalue(), content_type='image/webp')
            if path.endswith('/auth/me'): data={'loggedIn':True,'role':'member','username':'Test'}
            elif path.endswith('/library/photos'): data={'photos':photos, 'next_cursor':None}
            elif path.endswith('/library/years'): data={'years':[{'year':2026,'count':200}]}
            elif path.endswith('/metadata'): data={'width':4000,'height':8000 if os.environ.get('PORTRAIT') == '1' and '/photos/20/' in path else 3000}
            elif path.endswith('/detections'): data={'detections':[]}
            elif path.endswith('/library/counts'): data={'total_files':200,'photos':200,'videos':0}
            elif path.endswith('/stats'): data={'people':{'groups':0}}
            elif path.endswith('/favorites/count'): data={'count':0}
            else: data={}
            await route.fulfill(json=data)

        async def verify_scroll_cache():
            nonlocal hold_returning_thumbnail
            photos[0]['thumbnail_url'] = '/api/fixture/expired-thumbnail'
            fixture = await browser.new_context(viewport={'width':1280,'height':800})
            await fixture.add_cookies([{'name':'kindred_session', 'value':'fixture', 'url':'http://localhost:3109'}])
            await fixture.add_init_script("Object.defineProperty(navigator, 'connection', {value:{saveData:true}})")
            await fixture.route('**/api/**', api)
            try:
                gallery = await fixture.new_page()
                await gallery.goto('http://localhost:3109/gallery')
                tile = gallery.locator('[data-photo-id="0"]')
                ready = """() => document.querySelector('[data-photo-id="0"] img')?.naturalWidth > 0"""
                await gallery.wait_for_function(ready)
                assert expired_requests == 1, expired_requests
                initial = Image.open(BytesIO(await tile.screenshot())).convert('RGB')
                scroller = gallery.locator('.kx-content')
                await scroller.evaluate('(element) => element.scrollTop = 3000')
                await tile.wait_for(state='detached')
                hold_returning_thumbnail = True
                await scroller.evaluate('(element) => element.scrollTop = 0')
                await tile.wait_for(state='visible', timeout=5000)
                returned = Image.open(BytesIO(await tile.screenshot())).convert('RGB')
                center = (initial.width // 2, initial.height // 2)
                assert returned.getpixel(center) == initial.getpixel(center), (initial.getpixel(center), returned.getpixel(center))
                assert await tile.locator('img').count() == 0, 'Returning tile still depends on a new image element'
                assert expired_requests == 1, expired_requests
                assert remount_requests == 0, remount_requests
                print(json.dumps({'returning_thumbnail_painted':True,'returning_thumbnail_requests':remount_requests}))
            finally:
                hold_returning_thumbnail = False
                release_thumbnail.set()
                await fixture.close()
                del photos[0]['thumbnail_url']
                requests.clear()

        await verify_scroll_cache()
        if '--scroll-cache-only' in sys.argv[1:]:
            await browser.close()
            return

        await context.route('**/api/**',api)
        await page.goto('http://localhost:3109/gallery')
        await page.locator('.kx-tile').first.wait_for()
        await page.wait_for_timeout(1700)
        initial=list(requests)
        assert 0<len(initial)<70, len(initial)
        assert all(160 <= int(parse_qs(urlparse(u).query)['w'][0]) <= 960 for u in initial)
        assert all(parse_qs(urlparse(u).query).get('size') == ['n'] for u in initial), 'Unsafe on older NAS'
        if os.environ.get('LEGACY_BACKEND') == '1':
            assert await page.locator('.kx-tile img').evaluate_all('(images) => images.filter(i => i.complete && i.naturalWidth).every(i => i.naturalWidth <= 512)')
        before=len(requests)
        await page.mouse.move(600,500); await page.mouse.wheel(0,1100); await page.wait_for_timeout(1200)
        assert len(requests)>before
        tile = page.locator('.kx-tile').nth(20)
        await tile.scroll_into_view_if_needed()
        await page.wait_for_function("() => { const img = document.querySelectorAll('.kx-tile')[20]?.querySelector('img'); return img?.complete && img.naturalWidth > 0; }")
        selected_id = await tile.get_attribute('data-photo-id')
        await tile.click()
        placeholder = page.locator('.lb-placeholder')
        await placeholder.wait_for()
        await page.wait_for_function("() => document.querySelector('.lb-placeholder')?.naturalWidth > 0")
        placeholder_box = await placeholder.bounding_box()
        stage_box = await page.locator('.lb-photo-stage').bounding_box()
        assert placeholder_box == stage_box, (placeholder_box, stage_box)
        assert await placeholder.evaluate("(img) => getComputedStyle(img).objectPosition") == '50% 50%'
        release_preview.set()
        full_image = page.locator('.lb-main-image.is-loaded')
        await full_image.wait_for()
        assert await full_image.bounding_box() == placeholder_box
        assert await placeholder.count() == 0
        await page.wait_for_timeout(1000)
        lightbox=list(requests)
        assert not any('size=o' in u for u in lightbox)
        preview=await page.locator('.lb-main-image').get_attribute('src')
        assert parse_qs(urlparse(preview).query)['format'] == ['jpeg']
        width=int(parse_qs(urlparse(preview).query)['w'][0]); assert 960<=width<=2560,width
        adjacent=[u for u in requests if any(f'/photos/{i}/image' in u for i in [18,19,21,22]) and int(parse_qs(urlparse(u).query)['w'][0])>960]
        assert len(adjacent)>=4, adjacent
        assert len(requests)<110, len(requests)
        await page.screenshot(path='/tmp/kindred-image-browser.png')
        assert not errors, errors
        print(json.dumps({'initial_thumbnail_requests':len(initial),'after_scroll_and_lightbox':len(requests),'preview_width':width,'adjacent_preview_requests':len(adjacent),'original_requests':0,'page_errors':errors}))
        async with page.expect_download() as download_event:
            await page.locator('.lb-action-btn[aria-label="Download"]').click()
        download = await download_event.value
        assert 'size=o' in download.url, download.url
        await context.close()
        context = await browser.new_context(viewport={'width':1280,'height':800}, device_scale_factor=2)
        await context.add_cookies([{'name':'kindred_session','value':'fixture','url':'http://localhost:3109'}])
        await context.add_init_script("Object.defineProperty(navigator, 'connection', {value:{saveData:true,effectiveType:'4g'}})")
        await context.route('**/api/**',api)
        requests.clear()
        page = await context.new_page()
        await page.goto('http://localhost:3109/gallery')
        await page.locator('.kx-tile').first.wait_for()
        await page.wait_for_timeout(1000)
        assert 0 < len(requests) < 12, len(requests)
        print(json.dumps({'save_data_thumbnail_requests':len(requests),'download_original_only_after_click':True}))
        await context.close(); await browser.close()
asyncio.run(main())
