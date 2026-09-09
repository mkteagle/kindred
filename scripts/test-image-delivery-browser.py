"""Browser request regression using synthetic API responses; see docs/image-delivery.md."""
import asyncio, json, os
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
        page.on('pageerror', lambda error: errors.append(str(error)))
        photos=[dict(photo_id=str(i), photo_title=f'Photo {i}', date_taken='2026-08-20T12:00:00', media_kind='photo', duration_seconds=None) for i in range(200)]
        async def api(route):
            url=route.request.url; path=urlparse(url).path
            if path.endswith('/image'):
                query=parse_qs(urlparse(url).query); width=int(query.get('w',['4000'])[0]); requests.append(url)
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
        await context.route('**/api/**',api)
        await page.goto('http://localhost:3109/gallery')
        await page.locator('.kx-tile').first.wait_for()
        await page.wait_for_timeout(1700)
        initial=list(requests)
        assert 0<len(initial)<70, len(initial)
        assert all(160 <= int(parse_qs(urlparse(u).query)['w'][0]) <= 960 for u in initial)
        before=len(requests)
        await page.mouse.move(600,500); await page.mouse.wheel(0,1100); await page.wait_for_timeout(1200)
        assert len(requests)>before
        await page.locator('.kx-tile').nth(20).click()
        await page.locator('.lb-main-image.is-loaded').wait_for()
        await page.wait_for_timeout(1000)
        lightbox=list(requests)
        assert not any('size=o' in u for u in lightbox)
        preview=await page.locator('.lb-main-image').get_attribute('src')
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
