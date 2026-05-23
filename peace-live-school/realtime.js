import { createClient }
from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl =
'https://ckfwokjxarnhoxrqugmi.supabase.co'
const supabaseKey =
'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrZndva2p4YXJuaG94cnF1Z21pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNzU0NDQsImV4cCI6MjA4Nzk1MTQ0NH0.Rd0_bkS6pZK-CCsvl6Mfr0NehgNX107oUQx3v1uRjPQ'

const supabase =
createClient(
supabaseUrl,
supabaseKey
)

const chatMessages =
document.getElementById(
'chatMessages'
)

const messageInput =
document.getElementById(
'messageInput'
)

async function loadMessages(){

const { data } =
await supabase
.from('live_messages')
.select('*')
.order('id',{ascending:true})

chatMessages.innerHTML = ''

data.forEach((msg)=>{

chatMessages.innerHTML += `

<div style="
background:#eef3ff;
padding:10px;
margin:10px;
border-radius:10px;
">

<b>${msg.student_name}</b>

<br>

${msg.message}

</div>

`

})

}

window.sendMessage =
async function(){

if(messageInput.value === '')
return

const text =
messageInput.value

messageInput.value = ''

const { error } =
await supabase
.from('live_messages')
.insert([{

student_name:'Student',

message:text

}])

if(error){

alert(error.message)

}

}

supabase
.channel('room1')

.on(
'postgres_changes',
{
event:'INSERT',
schema:'public',
table:'live_messages'
},
(payload)=>{

chatMessages.innerHTML += `

<div style="
background:#eef3ff;
padding:10px;
margin:10px;
border-radius:10px;
">

<b>${payload.new.student_name}</b>

<br>

${payload.new.message}

</div>

`

}
)

.subscribe()

loadMessages()
