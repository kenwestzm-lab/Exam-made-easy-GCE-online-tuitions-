path = '/data/data/com.termux/files/home/school/public/index.html'

with open(path, encoding='utf-8') as f:
    content = f.read()

fixes = 0

# Fix 1: states
old1 = "  const [showMenu, setShowMenu] = useState(false);\n  const [recSecs, setRecSecs] = useState(0);\n  const [waveVals, setWaveVals] = useState([4,8,5,10,6,9,4,7,5,8]);"
new1 = "  const [showMenu, setShowMenu] = useState(false);\n  const [showNewGroup, setShowNewGroup] = useState(false);\n  const [showSettings, setShowSettings] = useState(false);\n  const [myGroups, setMyGroups] = useState([]);\n  const [recSecs, setRecSecs] = useState(0);\n  const [waveVals, setWaveVals] = useState([4,8,5,10,6,9,4,7,5,8]);"
if old1 in content:
    content = content.replace(old1, new1, 1); fixes += 1; print("Fix 1 OK - states")
else:
    print("Fix 1 FAILED")

# Fix 2: load groups + socket listeners
old2 = "  const others = users.filter(u => u._id !== profile?._id);\n  const groups = [{id:0,n:'General Chat',i:'school'}, ...SUBJECTS.map(s=>({id:s.id,n:s.n,i:s.i}))];"
new2 = (
    "  const others = users.filter(u => u._id !== profile?._id);\n"
    "  const groups = [{id:0,n:'General Chat',i:'school'}, ...SUBJECTS.map(s=>({id:s.id,n:s.n,i:s.i}))];\n"
    "\n"
    "  useEffect(()=>{\n"
    "    if(!profile) return;\n"
    "    apiFetch('GET','/groups',null,tok()).then(d=>{ if(Array.isArray(d)) setMyGroups(d); }).catch(()=>{});\n"
    "  },[profile?._id]);\n"
    "\n"
    "  useEffect(()=>{\n"
    "    if(!socket) return;\n"
    "    const onCreated = g => setMyGroups(p=>[...p.filter(x=>x._id!==g._id),g]);\n"
    "    const onUpdated = g => setMyGroups(p=>p.map(x=>x._id===g._id?g:x));\n"
    "    const onAdded = g => setMyGroups(p=>[...p.filter(x=>x._id!==g._id),g]);\n"
    "    const onRemoved = ({groupId}) => setMyGroups(p=>p.filter(x=>x._id!==groupId));\n"
    "    const onDeleted = ({groupId}) => setMyGroups(p=>p.filter(x=>x._id!==groupId));\n"
    "    socket.on('group_created',onCreated); socket.on('group_updated',onUpdated);\n"
    "    socket.on('group_added',onAdded); socket.on('group_removed',onRemoved);\n"
    "    socket.on('group_deleted',onDeleted);\n"
    "    return ()=>{\n"
    "      socket.off('group_created',onCreated); socket.off('group_updated',onUpdated);\n"
    "      socket.off('group_added',onAdded); socket.off('group_removed',onRemoved);\n"
    "      socket.off('group_deleted',onDeleted);\n"
    "    };\n"
    "  },[socket]);"
)
if old2 in content:
    content = content.replace(old2, new2, 1); fixes += 1; print("Fix 2 OK - group loading")
else:
    print("Fix 2 FAILED")

# Fix 3: menu items wired
old3 = "[['New Group',()=>setShowMenu(false)],['Settings',()=>setShowMenu(false)]].map(([label,fn])=>\n              React.createElement('div',{key:label,onClick:fn,style:{padding:'13px 18px',fontSize:14,color:'#111',cursor:'pointer',borderBottom:'1px solid #f0f0f0'}},label)\n            )"
new3 = (
    "[['\u2795 New Group',()=>{setShowMenu(false);setShowNewGroup(true);}],['\u2699\ufe0f Settings',()=>{setShowMenu(false);setShowSettings(true);}]].map(([label,fn])=>\n"
    "              React.createElement('div',{key:label,onClick:fn,style:{padding:'13px 18px',fontSize:14,color:'#111',cursor:'pointer',borderBottom:'1px solid #f0f0f0'}},label)\n"
    "            )"
)
if old3 in content:
    content = content.replace(old3, new3, 1); fixes += 1; print("Fix 3 OK - menu wired")
else:
    print("Fix 3 FAILED")

# Fix 4: New Group modal + Settings panel
old4 = "  // Chat list view\n  if (!sel && selG===null) {"
new4 = (
    "  // NEW GROUP MODAL\n"
    "  if (showNewGroup) {\n"
    "    const [ngName,setNgName] = React.useState('');\n"
    "    const [ngBio,setNgBio] = React.useState('');\n"
    "    const [ngPicks,setNgPicks] = React.useState([]);\n"
    "    const [ngBusy,setNgBusy] = React.useState(false);\n"
    "    const [ngErr,setNgErr] = React.useState('');\n"
    "    const [ngPhoto,setNgPhoto] = React.useState(null);\n"
    "    const createGroup = async () => {\n"
    "      if(!ngName.trim()){setNgErr('Please enter a group name');return;}\n"
    "      setNgBusy(true); setNgErr('');\n"
    "      try {\n"
    "        const fd = new FormData();\n"
    "        fd.append('name', ngName.trim());\n"
    "        fd.append('bio', ngBio);\n"
    "        ngPicks.forEach(id => fd.append('member_ids', id));\n"
    "        if(ngPhoto) fd.append('photo', ngPhoto);\n"
    "        const r = await fetch(BACKEND+'/api/groups',{method:'POST',headers:{Authorization:'Bearer '+tok()},body:fd});\n"
    "        const g = await r.json();\n"
    "        if(!r.ok) throw new Error(g.error||'Failed');\n"
    "        setMyGroups(p=>[g,...p.filter(x=>x._id!==g._id)]);\n"
    "        setShowNewGroup(false);\n"
    "      } catch(e){setNgErr(e.message);}\n"
    "      finally{setNgBusy(false);}\n"
    "    };\n"
    "    return React.createElement('div',{style:{height:'100%',display:'flex',flexDirection:'column',background:'#f0f2f5'}},\n"
    "      React.createElement('div',{style:{background:'#075E54',color:'#fff',padding:'12px 16px',display:'flex',alignItems:'center',gap:12,flexShrink:0}},\n"
    "        React.createElement('button',{onClick:()=>setShowNewGroup(false),style:{background:'none',border:'none',color:'#fff',fontSize:22,cursor:'pointer',padding:0}},'\u2190'),\n"
    "        React.createElement('div',{style:{fontWeight:700,fontSize:17}},'\u2795 New Group')\n"
    "      ),\n"
    "      React.createElement('div',{style:{flex:1,overflowY:'auto',padding:16}},\n"
    "        React.createElement('div',{style:{background:'#fff',borderRadius:14,padding:16,marginBottom:14,boxShadow:'0 1px 4px rgba(0,0,0,0.08)'}},\n"
    "          React.createElement('div',{style:{marginBottom:12}},\n"
    "            React.createElement('label',{style:{fontSize:12,fontWeight:700,color:'#075E54',display:'block',marginBottom:6}},'Group Name *'),\n"
    "            React.createElement('input',{value:ngName,onChange:e=>setNgName(e.target.value),placeholder:'e.g. Chemistry Study Group',style:{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid #e5e7eb',fontSize:14,outline:'none',boxSizing:'border-box'}})\n"
    "          ),\n"
    "          React.createElement('div',{style:{marginBottom:12}},\n"
    "            React.createElement('label',{style:{fontSize:12,fontWeight:700,color:'#075E54',display:'block',marginBottom:6}},'Description (optional)'),\n"
    "            React.createElement('textarea',{value:ngBio,onChange:e=>setNgBio(e.target.value),placeholder:'What is this group about?',rows:2,style:{width:'100%',padding:'10px 14px',borderRadius:10,border:'1.5px solid #e5e7eb',fontSize:14,outline:'none',resize:'none',boxSizing:'border-box'}})\n"
    "          ),\n"
    "          React.createElement('div',null,\n"
    "            React.createElement('label',{style:{fontSize:12,fontWeight:700,color:'#075E54',display:'block',marginBottom:6}},'Group Photo (optional)'),\n"
    "            React.createElement('input',{type:'file',accept:'image/*',onChange:e=>setNgPhoto(e.target.files[0]),style:{fontSize:13}})\n"
    "          )\n"
    "        ),\n"
    "        React.createElement('div',{style:{background:'#fff',borderRadius:14,padding:16,boxShadow:'0 1px 4px rgba(0,0,0,0.08)'}},\n"
    "          React.createElement('div',{style:{fontSize:13,fontWeight:700,color:'#075E54',marginBottom:12}},'\ud83d\udc65 Add Members (',ngPicks.length,' selected)'),\n"
    "          others.map(u=>React.createElement('div',{key:u._id,onClick:()=>setNgPicks(p=>p.includes(u._id)?p.filter(x=>x!==u._id):[...p,u._id]),style:{display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderBottom:'1px solid #f0f2f5',cursor:'pointer'}},\n"
    "            React.createElement('div',{style:{width:38,height:38,borderRadius:'50%',background:ngPicks.includes(u._id)?'#075E54':'#e5e7eb',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,color:ngPicks.includes(u._id)?'#fff':'#666',fontSize:16,flexShrink:0,overflow:'hidden'}},\n"
    "              u.avatarUrl ? React.createElement('img',{src:u.avatarUrl,style:{width:'100%',height:'100%',objectFit:'cover'}}) : (u.name?.[0]||'?')\n"
    "            ),\n"
    "            React.createElement('div',{style:{flex:1}},\n"
    "              React.createElement('div',{style:{fontWeight:600,fontSize:14}},(u.name||'Unknown')),\n"
    "              React.createElement('div',{style:{fontSize:11,color:'#666',textTransform:'capitalize'}},(u.role||''))\n"
    "            ),\n"
    "            ngPicks.includes(u._id) && React.createElement('span',{style:{fontSize:18,color:'#25D366'}},'\u2713')\n"
    "          ))\n"
    "        ),\n"
    "        ngErr && React.createElement('div',{style:{margin:'12px 0',padding:'10px 14px',background:'#fef2f2',borderRadius:10,color:'#dc2626',fontSize:13}},ngErr)\n"
    "      ),\n"
    "      React.createElement('div',{style:{padding:'12px 16px',background:'#fff',borderTop:'1px solid #e5e7eb'}},\n"
    "        React.createElement('button',{onClick:createGroup,disabled:ngBusy,style:{width:'100%',padding:'14px',background:ngBusy?'#9ca3af':'linear-gradient(135deg,#075E54,#128C7E)',border:'none',borderRadius:12,color:'#fff',fontSize:15,fontWeight:700,cursor:ngBusy?'not-allowed':'pointer'}},ngBusy?'\u23f3 Creating...' : '\u2795 Create Group')\n"
    "      )\n"
    "    );\n"
    "  }\n"
    "\n"
    "  // SETTINGS PANEL\n"
    "  if (showSettings) {\n"
    "    const [notifOn,setNotifOn] = React.useState(true);\n"
    "    const [blocked,setBlocked] = React.useState([]);\n"
    "    const [settsBusy,setSettsBusy] = React.useState(false);\n"
    "    useEffect(()=>{\n"
    "      apiFetch('GET','/users/prefs',null,tok()).then(d=>{\n"
    "        if(d.notifications_enabled!==undefined) setNotifOn(d.notifications_enabled);\n"
    "        if(Array.isArray(d.blocked_users)) setBlocked(d.blocked_users);\n"
    "      }).catch(()=>{});\n"
    "    },[]);\n"
    "    const toggleNotif = async () => {\n"
    "      const next = !notifOn; setNotifOn(next);\n"
    "      try { await apiFetch('PUT','/users/prefs/notifications',{enabled:next},tok()); } catch(e){}\n"
    "    };\n"
    "    const unblock = async (uid) => {\n"
    "      try { await apiFetch('DELETE','/users/block/'+uid,null,tok()); setBlocked(p=>p.filter(b=>b._id!==uid)); } catch(e){}\n"
    "    };\n"
    "    const clearChat = async (uid, name) => {\n"
    "      if(!confirm('Clear all messages with '+name+'?')) return;\n"
    "      setSettsBusy(true);\n"
    "      try { await apiFetch('DELETE','/users/clear-chat/'+uid,null,tok()); alert('Chat cleared!'); } catch(e){alert(e.message);}\n"
    "      finally{setSettsBusy(false);}\n"
    "    };\n"
    "    return React.createElement('div',{style:{height:'100%',display:'flex',flexDirection:'column',background:'#f0f2f5'}},\n"
    "      React.createElement('div',{style:{background:'#075E54',color:'#fff',padding:'12px 16px',display:'flex',alignItems:'center',gap:12,flexShrink:0}},\n"
    "        React.createElement('button',{onClick:()=>setShowSettings(false),style:{background:'none',border:'none',color:'#fff',fontSize:22,cursor:'pointer',padding:0}},'\u2190'),\n"
    "        React.createElement('div',{style:{fontWeight:700,fontSize:17}},'\u2699\ufe0f Settings')\n"
    "      ),\n"
    "      React.createElement('div',{style:{flex:1,overflowY:'auto',padding:16}},\n"
    "        React.createElement('div',{style:{background:'#fff',borderRadius:14,padding:16,marginBottom:14,boxShadow:'0 1px 4px rgba(0,0,0,0.08)'}},\n"
    "          React.createElement('div',{style:{fontSize:13,fontWeight:700,color:'#075E54',marginBottom:12}},'\ud83d\udd14 Notifications'),\n"
    "          React.createElement('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0'}},\n"
    "            React.createElement('div',null,\n"
    "              React.createElement('div',{style:{fontWeight:600,fontSize:14}},'Message Notifications'),\n"
    "              React.createElement('div',{style:{fontSize:12,color:'#666'}},'Receive alerts for new messages')\n"
    "            ),\n"
    "            React.createElement('div',{onClick:toggleNotif,style:{width:48,height:26,borderRadius:13,background:notifOn?'#25D366':'#ccc',cursor:'pointer',position:'relative',transition:'background 0.2s'}},\n"
    "              React.createElement('div',{style:{position:'absolute',top:3,left:notifOn?22:3,width:20,height:20,borderRadius:'50%',background:'#fff',transition:'left 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.2)'}})\n"
    "            )\n"
    "          )\n"
    "        ),\n"
    "        blocked.length>0 && React.createElement('div',{style:{background:'#fff',borderRadius:14,padding:16,marginBottom:14,boxShadow:'0 1px 4px rgba(0,0,0,0.08)'}},\n"
    "          React.createElement('div',{style:{fontSize:13,fontWeight:700,color:'#075E54',marginBottom:12}},'\ud83d\udead Blocked Users'),\n"
    "          blocked.map(u=>React.createElement('div',{key:u._id,style:{display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderBottom:'1px solid #f0f2f5'}},\n"
    "            React.createElement('div',{style:{width:38,height:38,borderRadius:'50%',background:'#e5e7eb',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:16}},(u.name?.[0]||'?')),\n"
    "            React.createElement('div',{style:{flex:1}},React.createElement('div',{style:{fontWeight:600,fontSize:14}},(u.name||'Unknown'))),\n"
    "            React.createElement('button',{onClick:()=>unblock(u._id),style:{background:'#25D366',border:'none',borderRadius:20,padding:'6px 14px',color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer'}},'Unblock')\n"
    "          ))\n"
    "        ),\n"
    "        sel && React.createElement('div',{style:{background:'#fff',borderRadius:14,padding:16,boxShadow:'0 1px 4px rgba(0,0,0,0.08)'}},\n"
    "          React.createElement('div',{style:{fontSize:13,fontWeight:700,color:'#075E54',marginBottom:12}},'\ud83d\uddd1\ufe0f Chat Actions'),\n"
    "          React.createElement('button',{onClick:()=>clearChat(sel._id,sel.name),disabled:settsBusy,style:{width:'100%',padding:'12px',background:'#fef2f2',border:'1.5px solid #fecaca',borderRadius:10,color:'#dc2626',fontSize:14,fontWeight:600,cursor:'pointer'}},settsBusy?'\u23f3 Clearing...':'\ud83d\uddd1\ufe0f Clear Chat with '+sel.name)\n"
    "        )\n"
    "      )\n"
    "    );\n"
    "  }\n"
    "\n"
    "  // Chat list view\n"
    "  if (!sel && selG===null) {"
)
if old4 in content:
    content = content.replace(old4, new4, 1); fixes += 1; print("Fix 4 OK - modals added")
else:
    print("Fix 4 FAILED")

print(f"\nTotal fixes: {fixes}/4")
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Saved OK")
