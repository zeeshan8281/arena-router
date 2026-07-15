#!/usr/bin/env python3
# ponytail: one-shot generator for the CURRENT AutoRouter Arena architecture.
# Re-run to regenerate docs/arena-architecture.excalidraw.json.
import json

els = []
S = 5000
NAVY="#1a0c6d"; VIOLET="#5b4bd6"; TEAL="#0b7285"; GREEN="#2f7d32"; RED="#b0322f"; ORANGE="#b5820a"

def shape(kind,id,x,y,w,h,dashed=False,color=NAVY,bg="transparent"):
    els.append({"id":id,"type":kind,"x":x,"y":y,"width":w,"height":h,"angle":0,
        "strokeColor":color,"backgroundColor":bg,"fillStyle":"hachure","strokeWidth":2,
        "strokeStyle":"dashed" if dashed else "solid","roughness":0,"opacity":100,
        "groupIds":[],"frameId":None,"roundness":{"type":3} if kind=="rectangle" else None,
        "seed":S+len(els),"version":1,"versionNonce":S+len(els),"isDeleted":False,
        "boundElements":[],"updated":1700000000000,"link":None,"locked":False})

def box(id,x,y,w,h,dashed=False,color=NAVY,bg="transparent"): shape("rectangle",id,x,y,w,h,dashed,color,bg)

def text(id,x,y,w,s,size=13,color=NAVY):
    lines=s.count("\n")+1
    els.append({"id":id,"type":"text","x":x,"y":y,"width":w,"height":18*lines,"angle":0,
        "strokeColor":color,"backgroundColor":"transparent","fillStyle":"solid","strokeWidth":1,
        "strokeStyle":"solid","roughness":0,"opacity":100,"groupIds":[],"frameId":None,
        "roundness":None,"seed":S+len(els),"version":1,"versionNonce":S+len(els),"isDeleted":False,
        "boundElements":[],"updated":1700000000000,"link":None,"locked":False,"text":s,
        "fontSize":size,"fontFamily":1,"textAlign":"left","verticalAlign":"top","baseline":11,
        "containerId":None,"originalText":s,"lineHeight":1.25})

def arrow(id,x,y,pts,label=None,color=NAVY,dashed=False):
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    els.append({"id":id,"type":"arrow","x":x,"y":y,"width":max(xs)-min(xs) or 1,
        "height":max(ys)-min(ys) or 1,"angle":0,"strokeColor":color,"backgroundColor":"transparent",
        "fillStyle":"solid","strokeWidth":2,"strokeStyle":"dashed" if dashed else "solid",
        "roughness":0,"opacity":100,"groupIds":[],"frameId":None,"roundness":{"type":2},
        "seed":S+len(els),"version":1,"versionNonce":S+len(els),"isDeleted":False,"boundElements":[],
        "updated":1700000000000,"link":None,"locked":False,"points":pts,"lastCommittedPoint":None,
        "startBinding":None,"endBinding":None,"startArrowhead":None,"endArrowhead":"arrow"})
    if label:
        lx=x+pts[-1][0]; ly=y+pts[-1][1]
        text(id+"-l",min(x,lx)+6,min(y,ly)-16,260,label,size=11,color=VIOLET)

# ── Title ──
text("title",40,18,1300,"AutoRouter Arena — attested multi-stage routing competition  (quality vs compute, live inference, GitHub identity)",size=20)

# ── Participant (left) ──
box("p-policy",40,110,320,120,color=GREEN)
text("t-policy",54,120,300,"policy.ts  ← YOUR only submission",13,GREEN)
text("t-policy2",54,146,306,"decide(prompt, models) → Decision\n  { looper, candidates[] }\nrouted PER STAGE (prompt.stage.kind)\npure: no net / fs / clock / random",11)

box("p-browser",40,250,320,86)
text("t-br",54,259,300,"Browser · arena-router-ui",13)
text("t-br2",54,285,306,"Sign in with GitHub → /api/submit\nforwards github_token (never a name)",11,VIOLET)

box("p-cli",40,352,320,86)
text("t-cli",54,361,300,"CLI · autorouter",13)
text("t-cli2",54,387,306,"login --token · run (local) · submit\nsends github_token",11,VIOLET)

box("p-dev",40,454,320,82,dashed=True)
text("t-dev",54,462,300,"Local dev · autorouter run",13)
text("t-dev2",54,488,306,"scores vs PUBLIC dev set —\nprecomputed proxy, offline, no keys",11,VIOLET)

# ── External services (right) ──
box("x-gh",1140,150,330,70,color=ORANGE)
text("t-gh",1154,159,310,"GitHub API",13,ORANGE)
text("t-gh2",1154,185,316,"verify token → login (identity)",11,ORANGE)

box("x-or",1140,470,330,150,color=ORANGE)
text("t-or",1154,480,310,"OpenRouter",13,ORANGE)
text("t-or2",1154,506,316,"catalog models (llama-3.2-3b …\n  … llama-3.3-70b) + gpt-4o-mini judge\nreal inference · paid by organizer\nparticipants pay nothing",11,ORANGE)

# ── EigenCompute TEE (center, encloses the pipeline) ──
box("tee",420,95,690,1000,dashed=True,color=TEAL)
text("t-tee",436,102,660,"🔒 EigenCompute · Intel TDX enclave (sepolia) — sealed inputs, attested output",14,TEAL)

def step(id,y,h,s1,s2,color=NAVY):
    box(id,445,y,620,h,color=color)
    text(id+"-a",459,y+9,600,s1,13,color)
    text(id+"-b",459,y+33,606,s2,11)

step("s1",150,66,"1 · Verify GitHub token → gh:<login>","name derived in-enclave from GitHub — client can't set it (browser / CLI / curl)")
step("s2",228,58,"2 · Anti-copy gate","reject a policy byte-identical to the starter/example (comments+whitespace normalized)")
step("s3",298,86,"3 · SES sandbox (worker thread)","run policy: no fetch/fs/process → decisions[ task::stage ]  (pure, all stages upfront)",GREEN)
step("s4",396,150,"4 · Multi-stage harness   ⟳ per task → per stage",
     "route the stage → call the chosen model LIVE (OpenRouter)\nfeed prior stage output as context → chain the stages\nloopers: single · confidence · ratings · remom",VIOLET)
step("s5",558,74,"5 · LLM judge (gpt-4o-mini)","grade the FINAL chained transcript against the hidden rubric → quality ∈ [0,1]")
step("s6",644,96,"6 · Score + sign",
     "SCORE = mean(quality) − λ·mean(cost)\nreceipt { policy_hash, eval_set_hash, catalog_hash, results_root, score }\nKMS-sign with the enclave-bound key",RED)
step("s7",752,58,"7 · Leaderboard","best score per participant — name is always the verified gh:<login>")

box("secrets",445,828,620,86,dashed=True,color=ORANGE)
text("t-sec",459,837,600,"🔑 Sealed via KMS — decrypt ONLY inside this measured image:",12,ORANGE)
text("t-sec2",459,861,606,"MNEMONIC (signer) · OPENROUTER_API_KEY · HIDDEN_SET (tasks + rubrics — never leaves)",11,ORANGE)

# ── Verifier (bottom) ──
box("verify",420,1130,690,74,color=NAVY,bg="transparent")
text("t-v",436,1139,660,"Anyone verifies (no trust):",13)
text("t-v2",436,1163,666,"ethers.verifyMessage(canonical, signature) → recovers grader_address (on-chain Derived Address). UI: per-row 'verify signature'.",11,VIOLET)

# ── Arrows ──
# participant → submit paths
arrow("a-pol-br",200,230,[[0,0],[0,20]])
arrow("a-br-tee",360,293,[[0,0],[85,0],[85,-110],[85,-110]],"github_token + policy")
arrow("a-cli-tee",360,395,[[0,0],[85,0],[85,-210]])
# gh verify ↔ github api
arrow("a-gh",1065,183,[[0,0],[75,0]],"verify",color=ORANGE)
# spine down the pipeline
for a,b in [("s1",216),("s2",286),("s3",384),("s4",546),("s5",632),("s6",740)]:
    arrow("sp-"+a,755,b,[[0,0],[0,12]])
# harness ↔ openrouter (live inference)
arrow("a-or",1065,471,[[0,0],[75,40]],"call models live",color=ORANGE)
# judge ↔ openrouter
arrow("a-judge-or",1065,595,[[0,0],[75,0]],"judge",color=ORANGE)
# secrets feed harness + judge + sign (dashed up)
arrow("a-sec1",640,828,[[0,0],[0,-262]],"key",color=ORANGE,dashed=True)
arrow("a-sec2",870,828,[[0,0],[0,-174]],None,color=ORANGE,dashed=True)
# score → verifier
arrow("a-v",760,740,[[0,0],[0,390]],"signed receipt",color=RED)
# leaderboard → participant (shown on UI/CLI)
arrow("a-board-out",445,781,[[0,0],[-85,0],[-85,-460]],"board",color=VIOLET,dashed=True)

doc={"type":"excalidraw","version":2,"source":"arena-architecture","elements":els,"files":{}}
open("docs/arena-architecture.excalidraw.json","w").write(json.dumps(doc,indent=1))
print("wrote docs/arena-architecture.excalidraw.json —",len(els),"elements")
