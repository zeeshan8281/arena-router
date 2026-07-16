#!/usr/bin/env python3
# ponytail: one-shot generator for the DETAILED internal routing+scoring flow
# (src/grader/score.ts). Re-run → docs/arena-routing.excalidraw.json.
import json

els = []
S = 6000
NAVY="#1a0c6d"; VIOLET="#5b4bd6"; TEAL="#0b7285"; GREEN="#2f7d32"; RED="#b0322f"; ORANGE="#b5820a"

def shape(kind,id,x,y,w,h,dashed=False,color=NAVY):
    els.append({"id":id,"type":kind,"x":x,"y":y,"width":w,"height":h,"angle":0,
        "strokeColor":color,"backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,
        "strokeStyle":"dashed" if dashed else "solid","roughness":0,"opacity":100,"groupIds":[],
        "frameId":None,"roundness":{"type":3} if kind=="rectangle" else None,"seed":S+len(els),
        "version":1,"versionNonce":S+len(els),"isDeleted":False,"boundElements":[],
        "updated":1700000000000,"link":None,"locked":False})

def box(id,x,y,w,h,dashed=False,color=NAVY): shape("rectangle",id,x,y,w,h,dashed,color)
def diamond(id,x,y,w,h,color=NAVY): shape("diamond",id,x,y,w,h,False,color)

def text(id,x,y,w,s,size=13,color=NAVY):
    lines=s.count("\n")+1
    els.append({"id":id,"type":"text","x":x,"y":y,"width":w,"height":18*lines,"angle":0,
        "strokeColor":color,"backgroundColor":"transparent","fillStyle":"solid","strokeWidth":1,
        "strokeStyle":"solid","roughness":0,"opacity":100,"groupIds":[],"frameId":None,"roundness":None,
        "seed":S+len(els),"version":1,"versionNonce":S+len(els),"isDeleted":False,"boundElements":[],
        "updated":1700000000000,"link":None,"locked":False,"text":s,"fontSize":size,"fontFamily":1,
        "textAlign":"left","verticalAlign":"top","baseline":11,"containerId":None,"originalText":s,
        "lineHeight":1.25})

def arrow(id,x,y,pts,label=None,color=NAVY,dashed=False,up=False):
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    els.append({"id":id,"type":"arrow","x":x,"y":y,"width":max(xs)-min(xs) or 1,"height":max(ys)-min(ys) or 1,
        "angle":0,"strokeColor":color,"backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,
        "strokeStyle":"dashed" if dashed else "solid","roughness":0,"opacity":100,"groupIds":[],"frameId":None,
        "roundness":{"type":2},"seed":S+len(els),"version":1,"versionNonce":S+len(els),"isDeleted":False,
        "boundElements":[],"updated":1700000000000,"link":None,"locked":False,"points":pts,
        "lastCommittedPoint":None,"startBinding":None,"endBinding":None,"startArrowhead":None,"endArrowhead":"arrow"})
    if label:
        lx=x+pts[-1][0]; ly=y+pts[-1][1]
        text(id+"-l",min(x,lx)+6,min(y,ly)-16,300,label,size=11,color=VIOLET)

# ── Title ──
text("title",30,18,1400,"AutoRouter Arena — internal routing & scoring  (score.ts: multi-stage harness, per-stage loopers, live inference, judge, sign)",size=19)

# ── Inputs ──
box("in-task",30,60,380,150)
text("t-task",44,70,356,"HiddenTask  (KMS-sealed)",13)
text("t-task2",44,96,362,"id · title\nstages: [ { id, kind, prompt, signals } ]\nrubric — grades the FINAL result,\n  hidden from the policy",11,VIOLET)

box("in-dec",430,60,360,150,color=GREEN)
text("t-dec",444,70,336,"decisions[ task :: stage ]",13,GREEN)
text("t-dec2",444,96,342,"YOUR decide() output, per stage\n{ looper, candidates[] }\nprecomputed in the SES sandbox\n(pure — no inference here)",11)

box("in-cat",810,60,380,150,color=ORANGE)
text("t-cat",824,70,356,"catalog · params",13,ORANGE)
text("t-cat2",824,96,362,"price_per_call = COMPUTE proxy\nλ (cost weight) · confidence threshold\njudge model = gpt-4o-mini\nmodels reachable via OpenRouter",11)

# ── TASK loop ──
box("taskloop",20,250,1440,1300,dashed=True,color=NAVY)
text("t-tl",1170,258,290,"▼  for each task in the eval set   ⟳",13,NAVY)

box("transcript",55,300,400,56)
text("t-tr",69,309,382,"transcript = ''   — context, chained across stages",12)

# ── STAGE loop ──
box("stageloop",55,378,1385,910,dashed=True,color=VIOLET)
text("t-sl",1140,386,290,"▼  for each stage, in order   ⟳",13,VIOLET)
arrow("loopback",62,1260,[[0,0],[0,-848]],"⟳ next stage — transcript carried forward",color=VIOLET,dashed=True)

box("getdec",495,428,500,58)
text("t-gd",509,446,476,"①  decision = decisions[ task::stage ]",13)

diamond("valid",650,508,190,92)
text("t-va",690,536,150,"②  candidates\n     valid?\n  (in catalog)",12)

box("invalid",910,528,300,64,color=RED)
text("t-iv",924,538,286,"no → INVALID:\ntask scored 0 · stop",12,RED)

box("build",430,636,620,74)
text("t-bu",444,646,606,"③  message = title  +  transcript (prior-stage output)  +  stage.prompt",12)
text("t-bu2",444,684,606,"↑ the chaining: each stage sees what earlier stages produced",11,VIOLET)

diamond("switch",650,738,190,92)
text("t-sw",690,768,150,"④  switch\n   (looper)",13)

box("single",70,862,300,150,color=GREEN)
text("t-si",84,872,276,"SINGLE",13,GREEN)
text("t-si2",84,898,282,"───────────\ncall candidates[0]\n1 live call → output\ncheapest path",11)

box("conf",410,862,340,168,color=GREEN)
text("t-co",424,872,316,"CONFIDENCE  (escalate)",13,GREEN)
text("t-co2",424,898,322,"───────────\nfor id in candidates:\n  call id → conf = exp(avg_logprob)\n  if conf ≥ threshold: stop\nelse keep last · cost = calls made",11)

box("rate",790,862,340,168,color=GREEN)
text("t-ra",804,872,316,"RATINGS  (fan-out)",13,GREEN)
text("t-ra2",804,898,322,"───────────\ncall ALL candidates ∥\njudge each vs the stage goal\noutput = argmax quality\ncost = all candidates",11)

box("remom",1170,862,270,168,color=GREEN)
text("t-re",1184,872,246,"REMOM  (mixture)",13,GREEN)
text("t-re2",1184,898,252,"───────────\npropose: all candidates ∥\naggregate: candidates[0]\n  synthesizes → output\ncost = all + aggregator",11)

text("livenote",70,1038,900,"⬆ every model call above = LIVE OpenRouter inference (organizer-paid; participants free)",11,ORANGE)

box("stageout",430,1074,620,58)
text("t-so",444,1092,606,"⑤  stage result:  chosen model  +  output text",12)

box("append",430,1160,620,58)
text("t-ap",444,1178,606,"⑥  transcript += '## Stage k — ' + kind + output",12)

# ── after stages (still per task) ──
box("judge",55,1310,690,64,color=VIOLET)
text("t-ju",69,1319,676,"⑦  LLM judge (gpt-4o-mini):",12,VIOLET)
text("t-ju2",69,1343,676,"grade(final transcript, rubric) → quality ∈ [0,1]   · LIVE",11)

box("cost",775,1310,660,64)
text("t-cost",789,1319,646,"⑧  cost = Σ price_per_call over EVERY model called, all stages",12)
text("t-cost2",789,1343,646,"escalation & fan-out cost more compute",11,VIOLET)

box("row",55,1398,1380,54)
text("t-row",69,1416,1360,"⑨  row = { task, chosen_models[], quality, cost }   →  accumulate  ΣQ · ΣC · invalid",12)

# ── final ──
box("means",20,1590,430,120,color=RED)
text("t-me",34,1600,406,"after all tasks",13,RED)
text("t-me2",34,1628,412,"mean_quality = ΣQ / n\nmean_cost    = ΣC / n",12)

box("score",480,1590,430,120,color=RED)
text("t-sc",494,1600,406,"SCORE",13,RED)
text("t-sc2",494,1628,412,"= mean_quality − λ·mean_cost\n(+ β·oss_rate ; β = 0, all-open)",12)

box("sign",940,1590,510,120)
text("t-sg",954,1600,486,"seal it",13)
text("t-sg2",954,1626,492,"results_root = hash(rows)\nreceipt { policy_hash, eval_set_hash,\n  catalog_hash, results_root, score }\nKMS-sign (enclave key) → leaderboard",11,VIOLET)

# ── Arrows ──
arrow("a-in1",220,210,[[0,0],[0,90]])                                   # in-task → transcript
arrow("a-in2",610,210,[[0,0],[0,218],[135,218]])                        # in-dec → getdec
arrow("a-tr-gd",255,356,[[0,0],[0,48],[490,48]])                        # transcript → getdec
arrow("a-gd-va",745,486,[[0,0],[0,22]])                                 # getdec → valid
arrow("a-va-iv",840,554,[[0,0],[70,0]],"no",color=RED)                  # valid → invalid
arrow("a-va-bu",745,600,[[0,0],[0,36]],"yes")                           # valid → build (yes)
arrow("a-bu-sw",745,710,[[0,0],[0,28]])                                 # build → switch
# switch → loopers (fan)
arrow("a-sw-si",690,808,[[0,0],[-470,54]],"single")
arrow("a-sw-co",710,830,[[0,0],[-130,32]],"confidence")
arrow("a-sw-ra",790,830,[[0,0],[170,32]],"ratings")
arrow("a-sw-re",800,808,[[0,0],[505,54]],"remom")
# loopers → stageout (converge)
arrow("a-si-so",220,1012,[[0,0],[350,62]])
arrow("a-co-so",580,1030,[[0,0],[110,44]])
arrow("a-ra-so",960,1030,[[0,0],[-160,44]])
arrow("a-re-so",1305,1030,[[0,0],[-565,44]])
arrow("a-so-ap",740,1132,[[0,0],[0,28]])                                # stageout → append
arrow("a-ap-ju",740,1218,[[0,0],[0,74],[-340,74]],"after last stage")   # append → judge
arrow("a-ju-row",400,1374,[[0,0],[0,24]])                               # judge → row
arrow("a-cost-row",1105,1374,[[0,0],[0,24]])                            # cost → row
arrow("a-row-me",235,1452,[[0,0],[0,138]])                              # row → means
arrow("a-me-sc",450,1650,[[0,0],[30,0]])                                # means → score
arrow("a-sc-sg",910,1650,[[0,0],[30,0]],"signed")                       # score → sign

doc={"type":"excalidraw","version":2,"source":"arena-routing","elements":els,"files":{}}
open("docs/arena-routing.excalidraw.json","w").write(json.dumps(doc,indent=1))
print("wrote docs/arena-routing.excalidraw.json —",len(els),"elements")
