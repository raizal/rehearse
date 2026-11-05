"""Render every FigCraft page to design/<page name>.png. Run: python3 export.py"""
import base64, os
from build_design import ex, rpc
out = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'
for i,p in enumerate(ex('page.list')):
    ex('page.select',id=p['id']); fid=ex('node.find',root=p['id'])['ids'][0]
    data=base64.b64decode(rpc('ui.render',{"ids":[fid],"format":"png","scale":1})['data'])
    open(out+p['name'].lower().replace(' ','-')+'.png','wb').write(data)
ex('page.select',id=ex('page.list')[-2]['id'])
