"use strict";
function sandboxConfig(opts={}){
 const image=String(opts.image||process.env.NEXUS_SANDBOX_IMAGE||"node:22-bookworm-slim");
 return {runtime:process.env.NEXUS_SANDBOX_RUNTIME||"docker",image,network:"none",readOnlyRootFs:true,capDrop:["ALL"],noNewPrivileges:true,memory:"1g",cpus:"1",pidsLimit:128};
}
function assertProductionSandbox(config){if(config.runtime==="process"&&process.env.NODE_ENV==="production")throw new Error("unsafe process sandbox forbidden in production");return config;}
module.exports={sandboxConfig,assertProductionSandbox};
