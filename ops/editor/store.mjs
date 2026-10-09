import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, chmodSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hashPassword, fail} from './security.mjs';
import {validateNewPassword} from './password-policy.mjs';
import {SecurityOperations} from './security-operations.mjs';

export function publicUser(row) {
  return row?{id:row.id,username:row.username,displayName:row.display_name,role:row.role,active:Boolean(row.active),mustChangePassword:Boolean(row.must_change),createdAt:row.created_at}:null;
}
export class Store {
  constructor(filename) {
    this.filename=filename;
    mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','editor')),active INTEGER NOT NULL DEFAULT 1,password_hash TEXT NOT NULL,must_change INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,timestamp TEXT NOT NULL,actor_username TEXT NOT NULL,action TEXT NOT NULL,target_username TEXT NOT NULL,details TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until_at INTEGER NOT NULL);`);
    chmodSync(filename,0o600);
    // Additive, transactional migration. A consistent pre-migration SQLite
    // backup is kept next to the database; existing account hashes are intact.
    const columns=new Set(this.db.prepare('PRAGMA table_info(sessions)').all().map(column=>column.name));
    if(!columns.has('last_seen')) {
      const backup=filename+'.pre-security-v2.sqlite';
      try{this.db.exec(`VACUUM INTO '${backup.replaceAll("'","''")}'`);chmodSync(backup,0o600);}catch(error){if(!String(error.message).includes('already exists'))throw error;}
      this.db.exec('BEGIN IMMEDIATE');
      try{this.db.exec('ALTER TABLE sessions ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0; ALTER TABLE sessions ADD COLUMN mfa_verified INTEGER NOT NULL DEFAULT 0; ALTER TABLE sessions ADD COLUMN authenticated_at INTEGER NOT NULL DEFAULT 0; ALTER TABLE sessions ADD COLUMN reauth_until INTEGER NOT NULL DEFAULT 0; DELETE FROM sessions;');this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
    }
    this.security=new SecurityOperations(this.db);
  }
  row(id) {return this.db.prepare('SELECT * FROM users WHERE id=?').get(id);}
  byName(name) {return this.db.prepare('SELECT * FROM users WHERE username=?').get(name);}
  users() {return this.db.prepare('SELECT * FROM users ORDER BY username').all().map(publicUser);}
  audit(actor,action,target='',details={}) {return this.security.audit(actor,action,target,details);}
  events() {return this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all().map(row=>({id:row.id,timestamp:row.timestamp,actorUsername:row.actor_username,action:row.action,targetUsername:row.target_username,details:JSON.parse(row.details)}));}
  async add({username,displayName,role,password},actor='sistema',authorize=()=>{}) {
    username=String(username||'').trim().toLowerCase();
    if(!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username))fail(400,'El usuario debe tener entre 3 y 64 letras, números, puntos, guiones o guiones bajos.');
    displayName=String(displayName||username).trim();
    if(!displayName||displayName.length>120||!['admin','editor'].includes(role))fail(400,'Nombre o rol inválido.');
    validateNewPassword(password,{username,displayName});
    const passwordHash=await hashPassword(password);
    authorize();
    if(this.byName(username))fail(409,'Ese usuario ya existe.');
    const id=randomUUID();
    this.db.prepare('INSERT INTO users(id,username,display_name,role,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(id,username,displayName,role,passwordHash,new Date().toISOString());
    this.audit(actor,'usuario_creado',username,{role});
    return publicUser(this.row(id));
  }
  update(id,values,actor) {
    const row=this.row(id);if(!row)fail(404,'Usuario no encontrado.');
    const role=values.role??row.role;
    const active=values.active===undefined?Boolean(row.active):values.active;
    const displayName=values.displayName===undefined?row.display_name:String(values.displayName).trim();
    if(!['admin','editor'].includes(role)||typeof active!=='boolean'||!displayName||displayName.length>120)fail(400,'Nombre, estado o rol inválido.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(id===actor.id&&(!active||role!=='admin'))fail(409,'No puede desactivar ni quitar el rol de su propia cuenta administradora.');
      const current=this.row(id);
      if(current.role==='admin'&&current.active&&(!active||role!=='admin')) {
        const count=this.db.prepare("SELECT count(*) AS n FROM users WHERE active=1 AND role='admin'").get().n;
        if(count<=1)fail(409,'Debe conservar al menos un administrador activo.');
      }
      this.db.prepare('UPDATE users SET display_name=?,role=?,active=? WHERE id=?').run(displayName,role,Number(active),id);
      if(!active||role!==row.role)this.revoke(id);
      this.audit(actor.username,'usuario_actualizado',row.username,{role,active});
      this.db.exec('COMMIT');
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
    return publicUser(this.row(id));
  }
  revoke(id) {this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);}
  async setPassword(id,password,forceChange,actor,authorize=()=>{}) {
    const row=this.row(id);if(!row)fail(404,'Usuario no encontrado.');
    validateNewPassword(password,{username:row.username,displayName:row.display_name});
    const hash=await hashPassword(password);
    authorize();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE users SET password_hash=?,must_change=? WHERE id=?').run(hash,Number(forceChange),id);
      this.revoke(id);
      this.audit(actor,forceChange?'contraseña_restablecida':'contraseña_cambiada',row.username);
      this.db.exec('COMMIT');
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
    return publicUser(this.row(id));
  }
  async bootstrap(username,passwordFile) {
    if(this.db.prepare('SELECT count(*) AS n FROM users').get().n)return;
    if(!passwordFile)fail(500,'Falta el archivo de contraseña inicial del administrador.');
    const password=readFileSync(passwordFile,'utf8').trim();
    await this.add({username:username||'admin',displayName:'Administrador',role:'admin',password});
  }
  close() {this.db.close();}
}
