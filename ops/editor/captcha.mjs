import {randomBytes,randomInt,createHmac,timingSafeEqual} from 'node:crypto';
import sharp from 'sharp';
import {digest,token,fail} from './security.mjs';

const lifetime=5*60*1000;
const rateWindow=60*1000;
const generationLimit=20;
const alphabet='ABCDEFGHJKLMNPRTUVWXY2346789';
// Only a rasterized PNG leaves the server; vector glyph identities remain private.
const glyphs={
  A:'M1 28L9 1L17 28M4 18H14',B:'M2 1V28H10C21 28 21 14 10 14H2M2 1H10C20 1 20 14 10 14',
  C:'M17 4C10-2 1 2 1 14S10 31 17 25',D:'M2 1V28H8C23 28 23 1 8 1Z',
  E:'M17 1H2V28H17M2 14H14',F:'M17 1H2V28M2 14H14',G:'M17 5C10-2 1 2 1 14S10 31 17 25V16H10',
  H:'M2 1V28M17 1V28M2 14H17',J:'M17 1V21C17 31 2 31 2 21M10 1H20',
  K:'M2 1V28M17 1L2 15L18 28',L:'M2 1V28H18',M:'M1 28V1L10 18L19 1V28',
  N:'M2 28V1L18 28V1',P:'M2 28V1H10C22 1 22 15 10 15H2',
  R:'M2 28V1H10C22 1 22 15 10 15H2M10 15L19 28',T:'M0 1H20M10 1V28',
  U:'M2 1V20C2 32 18 32 18 20V1',V:'M1 1L10 28L19 1',W:'M0 1L4 28L10 12L16 28L20 1',
  X:'M1 1L19 28M19 1L1 28',Y:'M1 1L10 15L19 1M10 15V28',
  2:'M2 6C4-2 19-1 19 8C19 16 3 21 2 28H20',
  3:'M2 4C10-3 22 1 17 10L11 14C24 13 24 32 3 26',
  4:'M14 28V1L1 20H20',6:'M17 2C4-3 1 11 2 21C3 32 20 32 20 20C20 10 3 10 2 20',
  7:'M1 1H20L7 28',8:'M10 14C-4 13-2 0 10 1C23 0 24 13 10 14C-4 14-2 29 10 28C24 29 25 14 10 14',
  9:'M3 27C16 32 20 18 19 8C18-3 1-3 1 9C1 19 18 19 19 9'
};

export function generateCaptcha() {
  const answer=Array.from({length:5},()=>alphabet[randomInt(alphabet.length)]).join('');
  const dots=Array.from({length:24},()=>`<circle cx="${randomInt(4,246)}" cy="${randomInt(4,84)}" r="${randomInt(1,3)}" fill="#b5d4e4"/>`).join('');
  const curves=Array.from({length:3},()=>`<path d="M0 ${randomInt(8,80)}Q${randomInt(50,180)} ${randomInt(-10,98)} 250 ${randomInt(8,80)}" fill="none" stroke="#92b9ce" stroke-width="1.4"/>`).join('');
  const letters=[...answer].map((letter,index)=>{
    const x=25+index*43+randomInt(-3,4),y=24+randomInt(-4,5),rotation=randomInt(-11,12);
    return `<path d="${glyphs[letter]}" transform="translate(${x} ${y}) rotate(${rotation} 10 14) scale(1.25)" fill="none" stroke="#123d65" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  return {answer,svg:`<svg xmlns="http://www.w3.org/2000/svg" width="250" height="88" viewBox="0 0 250 88"><rect width="250" height="88" rx="8" fill="#f5f9fc"/>${dots}${curves}${letters}</svg>`};
}

function normalizedAnswer(value) {
  if(typeof value!=='string'||value.length>32)return '';
  const result=value.replace(/\s/g,'').toUpperCase();
  return /^[A-Z2-9]{5}$/.test(result)?result:'';
}

export class Captcha {
  constructor(db,{generator=generateCaptcha,now=Date.now}={}) {
    this.db=db;this.generator=generator;this.now=now;this.secret=randomBytes(32);this.rendering=0;
    db.exec(`CREATE TABLE IF NOT EXISTS captcha_challenges(id_hash TEXT PRIMARY KEY,solution_hash TEXT NOT NULL,binding_hash TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS captcha_expiry ON captcha_challenges(expires_at);
      CREATE TABLE IF NOT EXISTS captcha_rates(binding_hash TEXT PRIMARY KEY,count INTEGER NOT NULL,until_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS captcha_rate_expiry ON captcha_rates(until_at);`);
    // The signing secret is intentionally ephemeral; refreshing after a service restart creates a new challenge.
    db.exec('DELETE FROM captcha_challenges');
  }
  solution(id,answer) {return createHmac('sha256',this.secret).update(`${id}\0${answer}`).digest('hex');}
  invalidate(id) {if(typeof id==='string'&&/^[A-Za-z0-9_-]{43}$/.test(id))this.db.prepare('DELETE FROM captcha_challenges WHERE id_hash=?').run(digest(id));}
  throttleLogin(binding) {
    const now=this.now(),bindingHash=digest(`login\0${binding}`);
    this.db.prepare('DELETE FROM captcha_rates WHERE until_at<=?').run(now);
    const rate=this.db.prepare('SELECT * FROM captcha_rates WHERE binding_hash=?').get(bindingHash);
    if(rate?.count>=60) {
      const error=new Error('Demasiadas solicitudes de acceso. Espere un minuto antes de volver a intentar.');
      error.status=429;error.retryAfter=Math.max(1,Math.ceil((rate.until_at-now)/1000));throw error;
    }
    if(!rate&&this.db.prepare('SELECT count(*) AS n FROM captcha_rates').get().n>=10000)fail(503,'El acceso no está disponible temporalmente. Inténtelo de nuevo en un minuto.');
    this.db.prepare('INSERT INTO captcha_rates(binding_hash,count,until_at) VALUES(?,1,?) ON CONFLICT(binding_hash) DO UPDATE SET count=count+1').run(bindingHash,now+rateWindow);
  }
  async issue(binding,previous) {
    const now=this.now(),bindingHash=digest(binding);
    this.db.prepare('DELETE FROM captcha_challenges WHERE expires_at<=?').run(now);
    this.db.prepare('DELETE FROM captcha_rates WHERE until_at<=?').run(now);
    const rate=this.db.prepare('SELECT * FROM captcha_rates WHERE binding_hash=?').get(bindingHash);
    if(rate?.count>=generationLimit) {
      const error=new Error('Ha solicitado demasiados códigos. Espere un minuto antes de actualizar el CAPTCHA.');
      error.status=429;error.retryAfter=Math.max(1,Math.ceil((rate.until_at-now)/1000));throw error;
    }
    if(this.rendering>=8||this.db.prepare('SELECT count(*) AS n FROM captcha_challenges').get().n+this.rendering>=5000||(!rate&&this.db.prepare('SELECT count(*) AS n FROM captcha_rates').get().n>=10000))fail(503,'El CAPTCHA no está disponible temporalmente. Inténtelo de nuevo en un minuto.');
    const {answer,svg}=this.generator();
    if(!normalizedAnswer(answer)||typeof svg!=='string'||svg.length>20000||!svg.startsWith('<svg'))throw new Error('Invalid CAPTCHA generator.');
    // Reserve the rate and render slot before awaiting native image conversion.
    this.db.prepare('INSERT INTO captcha_rates(binding_hash,count,until_at) VALUES(?,1,?) ON CONFLICT(binding_hash) DO UPDATE SET count=count+1').run(bindingHash,now+rateWindow);
    this.rendering++;
    try {
      const png=await sharp(Buffer.from(svg),{limitInputPixels:1000000}).resize(500,176).png().toBuffer();
      const id=token(),expiresAt=this.now()+lifetime;
      // Failed rendering or rate limiting must not invalidate the displayed image.
      this.invalidate(previous);
      this.db.prepare('INSERT INTO captcha_challenges VALUES(?,?,?,?)').run(digest(id),this.solution(id,normalizedAnswer(answer)),bindingHash,expiresAt);
      return {id,image:'data:image/png;base64,'+png.toString('base64'),expiresAt};
    } finally {this.rendering--;}
  }
  consume(id,answer,binding) {
    const message='El CAPTCHA no es correcto o venció. Actualícelo e inténtelo de nuevo.';
    if(typeof id!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(id))fail(400,'Complete el CAPTCHA para iniciar sesión.');
    const row=this.db.prepare('DELETE FROM captcha_challenges WHERE id_hash=? RETURNING *').get(digest(id));
    const normalized=normalizedAnswer(answer);
    if(!row||row.expires_at<=this.now()||row.binding_hash!==digest(binding)||!normalized)fail(400,message);
    const actual=Buffer.from(this.solution(id,normalized),'hex'),expected=Buffer.from(row.solution_hash,'hex');
    if(!timingSafeEqual(actual,expected))fail(400,message);
    return true;
  }
}
