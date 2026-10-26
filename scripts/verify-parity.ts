import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
const results=[];
for(const writes of [false,true]){
 const client=new Client({name:"parity-verification",version:"1"});
 try{
 const env=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));env.ON_MCP_ENABLE_WRITES=writes?"1":"0";
 await client.connect(new StdioClientTransport({command:`${process.cwd()}/on`,args:["serve"],env,stderr:"pipe"}));
 const names=(await client.listTools()).tools.map(t=>t.name);
 if(names.includes("charge_start")!==writes || names.includes("charge_stop")!==writes)throw new Error("Write discovery gate failed");
 if(writes)for(const [name,args] of [["charge_start",{chargePointId:1,confirm:false}],["charge_stop",{sessionId:"1",confirm:false}]] as const){if(!(await client.callTool({name,arguments:args})).isError)throw new Error("Confirmation refusal failed");}
 const read=await client.callTool({name:"charging_status",arguments:{}});
 results.push({writes,initialize:true,tools:names,confirmationRefusal:writes?true:null,liveRead:read.isError?"blocked-auth-or-api":"passed",liveMutations:false,paidExecutionVerified:false});
 }finally{await client.close();}
}
console.log(JSON.stringify(results,null,2));
