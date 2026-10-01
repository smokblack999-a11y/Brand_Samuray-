"use strict";
const store=require("./store");
function status(){return store.getControl();}
function kill(reason="emergency_stop"){return store.setAutonomy(false,reason);}
function resume(){return store.setAutonomy(true,"manual_resume");}
function assertAutonomy(){ if(!store.autonomyEnabled()){const e=new Error("AUTONOMY_KILLED");e.code="AUTONOMY_KILLED";throw e;} return true; }
module.exports={status,kill,resume,assertAutonomy};
