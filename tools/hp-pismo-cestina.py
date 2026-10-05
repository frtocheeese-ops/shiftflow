from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.recordingPen import RecordingPen
import math, sys
f=TTFont("HARRP___.ttf"); glyf=f["glyf"]; hmtx=f["hmtx"]; cmap=f.getBestCmap()
order=list(f.getGlyphOrder()); new_glyphs={}
def add(name, glyph, adv):
    glyph.recalcBounds(glyf) if hasattr(glyph,"recalcBounds") else None
    glyf.glyphs[name]=glyph
    if name not in order: order.append(name)
    hmtx.metrics[name]=(adv, getattr(glyph,"xMin",0) or 0)
def top_info(name, band=150):
    rp=RecordingPen(); f.getGlyphSet()[name].draw(rp)
    P=[p for op,a in rp.value for p in a]; ymax=max(p[1] for p in P); top=[p[0] for p in P if p[1]>=ymax-band]
    return ymax, min(top), max(top)
def poly(pen, pts): pen.moveTo(pts[0]); [pen.lineTo(p) for p in pts[1:]]; pen.closePath()
def acute(pen,s): poly(pen,[(-55*s,0),(-15*s,0),(70*s,150*s),(20*s,165*s)])
def caron(pen,s): poly(pen,[(-85*s,150*s),(-45*s,150*s),(0,62*s),(45*s,150*s),(85*s,150*s),(20*s,0),(-20*s,0)])
def ring(pen,s):
    R,r,n=58*s,30*s,24
    poly(pen,[(R*math.cos(2*math.pi*k/n), R+R*math.sin(2*math.pi*k/n)) for k in range(n)])
    poly(pen,[(r*math.cos(-2*math.pi*k/n), R+r*math.sin(-2*math.pi*k/n)) for k in range(n)])
def apos(pen,s): poly(pen,[(0,0),(30*s,0),(75*s,130*s),(38*s,140*s)])
ACC={"acute":acute,"caron":caron,"ring":ring,"apos":apos}

# 1) „i" bez tečky: vynechat konturu ležící celou nad y=440 (tečka 457..629)
rp=RecordingPen(); f.getGlyphSet()[cmap[ord("i")]].draw(rp)
groups=[];cur=[]
for op,a in rp.value:
    cur.append((op,a))
    if op in ("closePath","endPath"): groups.append(cur); cur=[]
pen=TTGlyphPen(f.getGlyphSet())
for g in groups:
    if min(p[1] for op,a in g for p in a) < 440:
        for op,a in g: getattr(pen,op)(*a)
add("dotlessi", pen.glyph(), hmtx[cmap[ord("i")]][0])
f.setGlyphOrder(order); glyf.glyphOrder=order

def build(new, base, accent, upper, cp):
    gs=f.getGlyphSet(); s=1.0 if upper else 0.9; gap=95 if upper else 70
    ymax,x0,x1=top_info(base)
    pen=TTGlyphPen(gs); gs[base].draw(pen)
    adv=hmtx[base][0]
    if accent=="apos":     # ď ť: apostrof vpravo za celým písmenem, písmeno o kus širší
        rp2=RecordingPen(); gs[base].draw(rp2); xmax=max(p[0] for op,a in rp2.value for p in a)
        dx,dy=xmax+10, ymax-125*s; adv+=55
    else: dx,dy=(x0+x1)/2, ymax+gap
    ACC[accent](TransformPen(pen,(1,0,0,1,dx,dy)), s)
    add(new, pen.glyph(), adv); f.setGlyphOrder(order); glyf.glyphOrder=order
    for t in f["cmap"].tables:
        if t.isUnicode(): t.cmap[cp]=new
U=[("Aacute","A","acute",0xC1),("Ccaron","C","caron",0x10C),("Dcaron","D","caron",0x10E),("Eacute","E","acute",0xC9),("Ecaron","E","caron",0x11A),
   ("Iacute","I","acute",0xCD),("Ncaron","N","caron",0x147),("Oacute","O","acute",0xD3),("Rcaron","R","caron",0x158),("Scaron","S","caron",0x160),
   ("Tcaron","T","caron",0x164),("Uacute","U","acute",0xDA),("Uring","U","ring",0x16E),("Yacute","Y","acute",0xDD),("Zcaron","Z","caron",0x17D)]
L=[("aacute","a","acute",0xE1),("ccaron","c","caron",0x10D),("dcaron","d","apos",0x10F),("eacute","e","acute",0xE9),("ecaron","e","caron",0x11B),
   ("iacute","dotlessi","acute",0xED),("ncaron","n","caron",0x148),("oacute","o","acute",0xF3),("rcaron","r","caron",0x159),("scaron","s","caron",0x161),
   ("tcaron","t","apos",0x165),("uacute","u","acute",0xFA),("uring","u","ring",0x16F),("yacute","y","acute",0xFD),("zcaron","z","caron",0x17E)]
for new,base,acc,cp in U: build(new, cmap[ord(base)], acc, True, cp)
for new,base,acc,cp in L: build(new, cmap[ord(base)] if len(base)==1 else base, acc, False, cp)
for t in f["cmap"].tables:
    if t.isUnicode(): t.cmap[0x0131]="dotlessi"
f["OS/2"].usWinAscent=max(f["OS/2"].usWinAscent, 1060)
f.save("/tmp/hpfont/hp-cz.ttf")
g=TTFont("/tmp/hpfont/hp-cz.ttf"); c=g.getBestCmap()
CZ="ÁČĎÉĚÍŇÓŘŠŤÚŮÝŽáčďéěíňóřšťúůýž"; print("uloženo | čeština:", sum(1 for ch in CZ if ord(ch) in c), "/ 30 | glyfů:", len(g.getGlyphOrder()))
