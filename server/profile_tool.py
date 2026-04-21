import os,sys,getpass
try: import requests
except: os.system("pip install requests -q"); import requests

SERVER="http://localhost:3000"
TF=os.path.expanduser("~/.pms_token")

def sv(t): open(TF,"w").write(t)
def ld(): return open(TF).read().strip() if os.path.exists(TF) else None
def hd():
    t=ld()
    if not t: print("Not logged in! Choose 1 first."); return None
    return {"Authorization":f"Bearer {t}","Content-Type":"application/json"}
def G(t): return f"\033[32m{t}\033[0m"
def R(t): return f"\033[31m{t}\033[0m"
def Y(t): return f"\033[33m{t}\033[0m"
def C(t): return f"\033[36m{t}\033[0m"
def B(t): return f"\033[1m{t}\033[0m"

def login():
    print(B(C("\n=== LOGIN ==="))); email=input("Email: ").strip(); pw=getpass.getpass("Password: ")
    try:
        r=requests.post(f"{SERVER}/api/auth/login",json={"email":email,"password":pw},timeout=10); d=r.json()
        if r.status_code==200: sv(d["token"]); u=d["user"]; print(G(f"\nWelcome {u['name']}! Role: {u['role'].upper()}"))
        else: print(R(f"Error: {d.get('error','Login failed')}"))
    except Exception as e: print(R(f"Cannot connect! Is server running?\n{e}"))

def view():
    h=hd()
    if not h: return None
    try:
        u=requests.get(f"{SERVER}/api/auth/me",headers=h,timeout=10).json()
        print(B(C("\n=== YOUR PROFILE ===")))
        print(f"  Name:     {u.get('name','')}")
        print(f"  Email:    {u.get('email','')}")
        print(f"  Role:     {u.get('role','').upper()}")
        print(f"  Phone:    {u.get('phone','Not set')}")
        print(f"  Grade:    {u.get('grade','Not set')}")
        print(f"  Province: {u.get('province','Not set')}")
        print(f"  Bio:      {u.get('bio','Not set')}")
        print(f"  Avatar:   {u.get('avatar','')}")
        if u.get('avatarUrl'): print(f"  Pic URL:  {u['avatarUrl']}")
        if u.get('role')=='tutor':
            s=G("APPROVED") if u.get('approved') else Y("PENDING APPROVAL - WhatsApp 0772799672")
            print(f"  Status:   {s}")
        return u
    except Exception as e: print(R(f"Error: {e}")); return None

def edit():
    print(B(C("\n=== EDIT PROFILE ===")));print(Y("Press ENTER to keep current value"))
    cur=view()
    if not cur: return
    up={}
    n=input(f"\nName [{cur.get('name','')}]: ").strip()
    if n: up["name"]=n
    p=input(f"Phone [{cur.get('phone','')}]: ").strip()
    if p: up["phone"]=p
    provs=["Central","Copperbelt","Eastern","Luapula","Lusaka","Muchinga","Northern","North-Western","Southern","Western"]
    print("\nZambian Provinces:")
    for i,v in enumerate(provs,1): print(f"  {i}. {v}")
    pi=input(f"Province number [{cur.get('province','')}]: ").strip()
    if pi.isdigit() and 1<=int(pi)<=len(provs): up["province"]=provs[int(pi)-1]
    if cur.get('role')=='student':
        gs=["Form 1","Form 2","Form 3","Form 4","Form 5 (Grade 11)","Grade 12","Repeater"]
        print("\nGrades:")
        for i,v in enumerate(gs,1): print(f"  {i}. {v}")
        gi=input(f"Grade [{cur.get('grade','')}]: ").strip()
        if gi.isdigit() and 1<=int(gi)<=len(gs): up["grade"]=gs[int(gi)-1]
    b=input(f"Bio [{cur.get('bio','')}]: ").strip()
    if b: up["bio"]=b
    av=input(f"Avatar emoji [{cur.get('avatar','')}]: ").strip()
    if av: up["avatar"]=av
    if not up: print(Y("No changes.")); return
    h=hd()
    if not h: return
    try:
        r=requests.put(f"{SERVER}/api/auth/profile",headers=h,json=up,timeout=10)
        if r.status_code==200: print(G("\nProfile updated in real time!"))
        else: print(R(f"\nFailed: {r.json().get('error')}"))
    except Exception as e: print(R(f"\nError: {e}"))

def upload_pic():
    print(B(C("\n=== UPLOAD PROFILE PICTURE ===")))
    print(Y("Your camera photos are at: /storage/emulated/0/DCIM/Camera/"))
    print(Y("First time? Run: termux-setup-storage"))
    path=input("\nFull path to image (.jpg .png): ").strip()
    path=path.replace("~",os.path.expanduser("~"))
    if not os.path.exists(path): print(R(f"File not found!\nTry: /storage/emulated/0/DCIM/Camera/photo.jpg")); return
    ext=path.lower().split(".")[-1]
    if ext not in ["jpg","jpeg","png","gif","webp"]: print(R("Not an image! Use jpg/png/gif/webp")); return
    sz=os.path.getsize(path)/1024
    print(f"File size: {sz:.1f}KB")
    if sz>5000: print(R("Too large! Max 5MB")); return
    mime={"jpg":"image/jpeg","jpeg":"image/jpeg","png":"image/png","gif":"image/gif","webp":"image/webp"}.get(ext,"image/jpeg")
    print("Uploading to Cloudinary cloud...")
    t=ld()
    if not t: print(R("Not logged in!")); return
    try:
        with open(path,"rb") as f:
            r=requests.post(f"{SERVER}/api/auth/avatar",
                headers={"Authorization":f"Bearer {t}"},
                files={"avatar":(os.path.basename(path),f,mime)},timeout=60)
        if r.status_code==200:
            d=r.json(); print(G("\nPicture uploaded to Cloudinary!"))
            print(C(f"URL: {d.get('url','N/A')}"))
            print(G("Your profile picture is now live!"))
        else: print(R(f"\nFailed: {r.json().get('error','Error')}"))
    except Exception as e: print(R(f"\nError uploading: {e}"))

def change_pw():
    print(B(C("\n=== CHANGE PASSWORD ===")))
    cur=getpass.getpass("Current password: "); new=getpass.getpass("New password (min 6 chars): "); con=getpass.getpass("Confirm new password: ")
    if new!=con: print(R("Passwords dont match!")); return
    if len(new)<6: print(R("Too short! Min 6 characters")); return
    h=hd()
    if not h: return
    try:
        r=requests.put(f"{SERVER}/api/auth/change-password",headers=h,json={"currentPassword":cur,"newPassword":new},timeout=10)
        if r.status_code==200: print(G("\nPassword changed successfully!"))
        else: print(R(f"\nFailed: {r.json().get('error')}"))
    except Exception as e: print(R(f"\nError: {e}"))

def approval():
    print(B(C("\n=== TUTOR APPROVAL STATUS ===")))
    h=hd()
    if not h: return
    try:
        u=requests.get(f"{SERVER}/api/auth/me",headers=h,timeout=10).json()
        if u.get('role')=='tutor':
            if u.get('approved'): print(G("YOUR ACCOUNT IS APPROVED! Go login and start teaching!"))
            else: print(Y("STILL PENDING.\nWhatsApp admin: 0772799672\nTell them your name and email!"))
        else: print(G(f"Your {u.get('role')} account is active and ready!"))
    except Exception as e: print(R(f"Error: {e}"))

print(B(C("""
 ========================================
  PEACE MINDSET PRIVATE SCHOOL
  Profile Tool - Real Time - Zambia
  Server: http://localhost:3000
 ========================================""")))

try:
    r=requests.get(f"{SERVER}/api/health",timeout=3)
    print(G(f"Server: ONLINE"))
except: print(R(f"Server: OFFLINE! Open new tab, run: cd ~/school/server && node server.js"))

while True:
    print(B("\n--- MENU ---"))
    print("1. Login"); print("2. View profile"); print("3. Edit profile")
    print("4. Upload profile picture"); print("5. Change password")
    print("6. Check tutor approval"); print("7. Logout"); print("0. Exit")
    c=input("\nChoose (0-7): ").strip()
    if c=="1": login()
    elif c=="2": view()
    elif c=="3": edit()
    elif c=="4": upload_pic()
    elif c=="5": change_pw()
    elif c=="6": approval()
    elif c=="7":
        if os.path.exists(TF): os.remove(TF)
        print(G("Logged out!"))
    elif c=="0": print(G("Goodbye!")); break
    else: print(R("Invalid! Enter 0-7"))
    input(Y("\nPress ENTER..."))
