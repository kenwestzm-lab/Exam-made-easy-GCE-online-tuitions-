import os,sys,time
try: import requests
except: os.system("pip install requests -q"); import requests

SERVER="http://localhost:3000"
TF=os.path.expanduser("~/.pms_token")

def G(t): return f"\033[32m{t}\033[0m"
def Y(t): return f"\033[33m{t}\033[0m"
def R(t): return f"\033[31m{t}\033[0m"
def C(t): return f"\033[36m{t}\033[0m"
def B(t): return f"\033[1m{t}\033[0m"

t=open(TF).read().strip() if os.path.exists(TF) else None
if not t:
    print(R("Not logged in! Run profile_tool.py and login first."))
    sys.exit(1)

print(B(C("""
 ====================================
  TUTOR APPROVAL WATCHER
  Peace Mindset Private School
  Checking every 30 seconds...
  Press CTRL+C to stop
 ====================================""")))
print(Y("WhatsApp admin for faster approval: 0772799672"))
print(Y("Tell them your name and email address!\n"))

count=0
try:
    while True:
        count+=1
        try:
            r=requests.get(f"{SERVER}/api/auth/me",
                headers={"Authorization":f"Bearer {t}"},timeout=5)
            u=r.json()
            name=u.get("name","")
            role=u.get("role","")
            approved=u.get("approved",False)
            ts=time.strftime("%H:%M:%S")
            
            if approved:
                print(G(f"\n[{ts}] CHECK #{count}"))
                print(G("="*40))
                print(G(f"  YOUR ACCOUNT IS APPROVED!"))
                print(G(f"  Welcome {name}!"))
                print(G(f"  You can now login and start teaching."))
                print(G("="*40))
                print(G("\nGo login at the school website now!"))
                break
            else:
                print(f"\r[{ts}] Check #{count} - {name} - {Y('PENDING...')} (next in 30s)   ",end="",flush=True)
        except Exception as e:
            print(R(f"\r[{time.strftime('%H:%M:%S')}] Server error: {e}    "),end="",flush=True)
        
        time.sleep(30)
except KeyboardInterrupt:
    print(Y("\n\nStopped watching. Run again anytime!"))
