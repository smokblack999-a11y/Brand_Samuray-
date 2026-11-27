"use strict";
const seed=[
{id:"SR-001",name:"Арман С.",phone:"+7 701 000 11 22",car:"Toyota Camry 2021",service:"Полировка кузова",date:"Сегодня, 10:30",status:"new",score:82,value:85000},
{id:"SR-002",name:"Данияр К.",phone:"+7 702 000 22 33",car:"Hyundai Tucson 2022",service:"Детейлинг салона",date:"Сегодня, 11:15",status:"contacted",score:64,value:45000},
{id:"SR-003",name:"Марат А.",phone:"+7 707 000 33 44",car:"Kia K5 2023",service:"Керамическое покрытие",date:"Завтра, 09:00",status:"booked",score:91,value:160000},
{id:"SR-004",name:"Руслан Т.",phone:"+7 775 000 44 55",car:"Lexus RX 2020",service:"Тонировка",date:"Вчера, 16:40",status:"done",score:76,value:55000}
];
const labels={new:"Новая",contacted:"Связались",booked:"Записан",done:"Завершён"};
let leads=seed.map(x=>({...x})),filter="all",query="";
const $=id=>document.getElementById(id),money=n=>new Intl.NumberFormat("ru-RU").format(n)+" ₸";
function render(){
 const rows=leads.filter(x=>(filter==="all"||x.status===filter)&&[x.name,x.phone,x.car,x.service,x.id].join(" ").toLowerCase().includes(query));
 $("mTotal").textContent=leads.length;
 $("mNew").textContent=leads.filter(x=>x.status==="new").length;
 $("mBooked").textContent=leads.filter(x=>x.status==="booked").length;
 $("mValue").textContent=money(leads.filter(x=>x.status!=="done").reduce((s,x)=>s+x.value,0));
 $("leads").innerHTML=rows.map(x=>`<tr data-id="${x.id}" title="Нажмите, чтобы изменить статус"><td><span class="person">${esc(x.name)}</span><span class="sub">${esc(x.phone)}</span></td><td>${esc(x.car)}</td><td>${esc(x.service)}</td><td>${esc(x.date)}</td><td><span class="pill ${x.status}">${labels[x.status]}</span></td><td class="score">${x.score}/100</td></tr>`).join("");
 $("empty").hidden=rows.length!==0;
 document.querySelectorAll("tbody tr").forEach(row=>row.addEventListener("click",()=>cycle(row.dataset.id)));
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function cycle(id){const x=leads.find(v=>v.id===id);if(!x)return;const order=["new","contacted","booked","done"];x.status=order[(order.indexOf(x.status)+1)%order.length];render();}
$("filters").addEventListener("click",e=>{const b=e.target.closest("button[data-status]");if(!b)return;filter=b.dataset.status;document.querySelectorAll(".filter").forEach(x=>x.classList.toggle("active",x===b));render();});
$("search").addEventListener("input",e=>{query=e.target.value.trim().toLowerCase();render();});
$("newLead").addEventListener("click",()=> $("leadDialog").showModal());
$("leadForm").addEventListener("submit",e=>{if(e.submitter?.id!=="saveLead")return;e.preventDefault();const f=new FormData(e.currentTarget);const value=Number(f.get("value"));if(!Number.isFinite(value)||value<0||value>100000000)return;leads.unshift({id:"SR-"+String(Date.now()).slice(-6),name:f.get("name").trim(),phone:f.get("phone").trim(),car:f.get("car").trim(),service:f.get("service").trim(),date:"Только что",status:"new",score:50,value});e.currentTarget.reset();$("leadDialog").close();filter="all";document.querySelectorAll(".filter").forEach(x=>x.classList.toggle("active",x.dataset.status==="all"));render();});
render();