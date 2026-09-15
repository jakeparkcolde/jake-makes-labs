"""Run upstream app with optional Chromium preview disabled: browser work stays in Aside."""
import sys,os
from pathlib import Path
root=Path(__file__).resolve().parent
backend=root/'vendor/screenshot-to-code/backend'
os.chdir(backend)
sys.path.insert(0,str(backend))
from dotenv import load_dotenv
load_dotenv(backend/'.env')
from preview_screenshot.registry import set_screenshot_backend
class AsideOnlyPreview:
    async def available(self):
        print('Optional automatic screenshot preview disabled; manual validation uses Aside browser only.')
        return False
    async def capture(self,*args,**kwargs):
        raise RuntimeError('Automatic Chromium preview disabled; use Aside for visual validation.')
set_screenshot_backend(AsideOnlyPreview())
from main import app
if __name__=='__main__':
    import uvicorn
    uvicorn.run(app,host='127.0.0.1',port=7001)
