import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {fail} from './security.mjs';

const context=new AsyncLocalStorage();
export const withAuditContext=(value,operation)=>context.run(value,operation);
const sensitive=/password|contrase|secret|token|cookie|authorization|otp|recovery|cipher|hash|key/i;
const cleanText=(value,max=160)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max);
function safeDetails(value,depth=0){
  if(depth>3)return '[LIMITED]';
  if(Array.isArray(value))return value.slice(0,20).map(v=>safeDetails(v,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,20).map(([k,v])=>[cleanText(k,60),sensitive.test(k)?'[REDACTED]':safeDetails(v,depth+1)]));
  if(typeof value==='string')return cleanText(value,500);
  return ['number','boolean'].includes(typeof value)||value===null?value:null;
}
function days(value,fallback){const n=Number(value??fallback);if(!Number.isSafeInteger(n)||n<7||n>3650)throw new Error('El plazo de retención debe estar entre 7 y 3650 días.');return n;}
const immediate=new Set(['usuario_creado','usuario_actualizado','contraseña_restablecida','mfa_restablecido','mfa_desactivado','publicacion_fallida','cuenta_anonimizada']);
const failed=action=>/fallido|denegado|rechazado|limite|rate_limit|csrf|origen_no_autorizado|acceso_no_autorizado|autorizacion_denegada/i.test(action);

export class SecurityOperations {
  constructor(db,{logger=event=>process.stdout.write(JSON.stringify(event)+'\n'),retentionDays=process.env.AUDIT_RETENTION_DAYS,alertRetentionDays=process.env.ALERT_RETENTION_DAYS,clock=Date.now}={}){
    this.db=db;this.logger=logger;this.clock=clock;this.retentionDays=days(retentionDays,90);this.alertRetentionDays=days(alertRetentionDays,30);this.lastPrune=0;
    this.auditWrites=0;this.maxAuditRows=50000;
    db.exec(`CREATE TABLE IF NOT EXISTS security_alerts(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,last_at TEXT NOT NULL,kind TEXT NOT NULL,actor TEXT NOT NULL,summary TEXT NOT NULL,occurrences INTEGER NOT NULL DEFAULT 1,acknowledged_at TEXT,acknowledged_by TEXT);
      CREATE INDEX IF NOT EXISTS security_alert_last ON security_alerts(last_at);
      CREATE TABLE IF NOT EXISTS security_counters(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,until_at INTEGER NOT NULL);`);
    this.prune(true);
  }
  emit(event){
    // JSON encoding prevents log-line injection. Only allowlisted context and
    // structured descriptions reach Docker's host-managed log stream.
    try{this.logger(event);}catch{process.stderr.write('{"type":"cms_log_failure","message":"Security event output unavailable"}\n');}
  }
  audit(actor,action,target='',details={}){
    const now=this.clock(),timestamp=new Date(now).toISOString(),ctx=context.getStore()||{};
    const event={timestamp,actor:cleanText(actor),action:cleanText(action),target:cleanText(target,300),details:safeDetails(details),context:{correlationId:cleanText(ctx.correlationId||randomUUID(),80),ip:cleanText(ctx.ip||'local',80),userAgent:cleanText(ctx.userAgent||'',240)}};
    this.db.prepare('INSERT INTO audit(timestamp,actor_username,action,target_username,details) VALUES(?,?,?,?,?)').run(timestamp,event.actor,event.action,event.target,JSON.stringify({...event.details,context:event.context}));
    if(++this.auditWrites%100===0)this.capAudit();
    this.emit({type:'cms_audit',...event});
    if(immediate.has(event.action))this.raise(event.action,event.actor,'Operación sensible: '+event.action,now);
    if(failed(event.action)){
      const bucket=event.context.ip+'\0'+event.action;
      this.db.prepare('DELETE FROM security_counters WHERE until_at<?').run(now);
      this.db.prepare('INSERT INTO security_counters VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1').run(bucket,now+10*60000);
      const count=this.db.prepare('SELECT count FROM security_counters WHERE bucket=?').get(bucket).count;
      if(count===6||count%30===0)this.raise('intentos_repetidos',event.actor,'Intentos de acceso o solicitudes rechazadas repetidos.',now);
      this.db.exec('DELETE FROM security_counters WHERE bucket NOT IN (SELECT bucket FROM security_counters ORDER BY until_at DESC LIMIT 1000)');
    }
    this.prune();
    return event;
  }
  raise(kind,actor,summary,now=this.clock()){
    const timestamp=new Date(now).toISOString();
    const previous=this.db.prepare('SELECT id,last_at FROM security_alerts WHERE kind=? AND actor=? AND acknowledged_at IS NULL ORDER BY last_at DESC LIMIT 1').get(kind,actor);
    let id=previous?.id;
    if(previous&&now-Date.parse(previous.last_at)<10*60000)this.db.prepare('UPDATE security_alerts SET last_at=?,occurrences=occurrences+1 WHERE id=?').run(timestamp,id);
    else{id=randomUUID();this.db.prepare('INSERT INTO security_alerts(id,created_at,last_at,kind,actor,summary) VALUES(?,?,?,?,?,?)').run(id,timestamp,timestamp,cleanText(kind),cleanText(actor),cleanText(summary,300));}
    this.emit({type:'cms_security_alert',id,timestamp,kind:cleanText(kind),actor:cleanText(actor),summary:cleanText(summary,300)});
    this.db.exec('DELETE FROM security_alerts WHERE id NOT IN (SELECT id FROM security_alerts ORDER BY last_at DESC LIMIT 1000)');
    return id;
  }
  alerts(){return this.db.prepare('SELECT id,created_at AS createdAt,last_at AS lastAt,kind,actor,summary,occurrences,acknowledged_at AS acknowledgedAt,acknowledged_by AS acknowledgedBy FROM security_alerts ORDER BY last_at DESC LIMIT 100').all();}
  acknowledge(id,actor){
    if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))fail(400,'Alerta inválida.');
    const found=this.db.prepare('SELECT id FROM security_alerts WHERE id=?').get(id);if(!found)fail(404,'Alerta no encontrada.');
    this.db.prepare('UPDATE security_alerts SET acknowledged_at=?,acknowledged_by=? WHERE id=?').run(new Date(this.clock()).toISOString(),cleanText(actor),id);
    this.audit(actor,'alerta_revisada',id);
    return {ok:true};
  }
  status(){return {auditRetentionDays:this.retentionDays,alertRetentionDays:this.alertRetentionDays,maxAuditRows:this.maxAuditRows,unacknowledgedAlerts:this.db.prepare('SELECT count(*) AS n FROM security_alerts WHERE acknowledged_at IS NULL').get().n,channels:['administration','host-managed stdout'],lastPruneAt:this.lastPrune?new Date(this.lastPrune).toISOString():null};}
  capAudit(){this.db.prepare('DELETE FROM audit WHERE id<=(SELECT id FROM audit ORDER BY id DESC LIMIT 1 OFFSET ?)').run(this.maxAuditRows);}
  prune(force=false){
    const now=this.clock();if(!force&&now-this.lastPrune<3600000)return;
    this.db.prepare('DELETE FROM audit WHERE timestamp<?').run(new Date(now-this.retentionDays*86400000).toISOString());
    this.db.prepare('DELETE FROM security_alerts WHERE last_at<?').run(new Date(now-this.alertRetentionDays*86400000).toISOString());
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
    this.db.prepare('DELETE FROM attempts WHERE until_at<?').run(now);
    this.db.prepare('DELETE FROM security_counters WHERE until_at<?').run(now);
    this.capAudit();
    this.lastPrune=now;
  }
  anonymizeDisabled(id,actor){
    const row=this.db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!row)fail(404,'Usuario no encontrado.');
    if(row.active)fail(409,'Desactive la cuenta antes de anonimizarla.');
    const marker='removed-'+randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      for(const table of ['mfa_secrets','mfa_recovery'])if(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))this.db.prepare('DELETE FROM '+table+' WHERE user_id=?').run(id);
      this.db.prepare("UPDATE users SET username=?,display_name='Cuenta anonimizada',password_hash='disabled',role='editor',must_change=1 WHERE id=?").run(marker,id);
      this.db.prepare('UPDATE audit SET actor_username=? WHERE actor_username=?').run(marker,row.username);
      this.db.prepare('UPDATE audit SET target_username=? WHERE target_username=?').run(marker,row.username);
      this.db.prepare('UPDATE security_alerts SET actor=? WHERE actor=?').run(marker,row.username);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    this.audit(actor,'cuenta_anonimizada',marker);
    return {ok:true};
  }
}
