// Full-system check: the real print flow end to end, then an attack battery
// against it. Runs against the live API on loopback. Everything it creates is
// removed in the finally block; it asserts the cleanup too.
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { PDFDocument } from 'pdf-lib';

dotenv.config();

const API = 'http://127.0.0.1:5000';
const EMAIL = 'zz.flow.probe@example.com';
const EMAIL2 = 'zz.other.probe@example.com';
const PASSWORD = 'flow-probe-passphrase-77';
const EMPID = 'ZZFLOW01';
const EMPID2 = 'ZZFLOW02';

const sections = [];
let current = null;
const section = (name) => { current = { name, rows: [] }; sections.push(current); };
const check = (label, pass, extra = '') =>
  current.rows.push({ pass, label, extra: extra === '' ? '' : String(extra) });

await mongoose.connect(process.env.MONGODB_URI);
const Teacher = mongoose.model('Teacher', new mongoose.Schema({}, { strict: false, collection: 'teachers' }));
const PrintJob = mongoose.model('PrintJob', new mongoose.Schema({}, { strict: false, collection: 'printjobs' }));

const jobIdsMade = [];
let printCode = null, confidentialCode = null;

const mkTeacher = async (email, empId, name) => {
  await Teacher.deleteOne({ email });
  await Teacher.create({
    email, name, empId,
    password: await bcrypt.hash(PASSWORD, 12),
    department: 'General', approved: true, sessionsValidFrom: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
};

const login = async (email) => {
  const r = await fetch(`${API}/api/teacher/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return (await r.json().catch(() => ({}))).token;
};

const makePdf = async (pages = 2) => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]).drawText(`probe page ${i + 1}`, { x: 50, y: 780, size: 12 });
  return Buffer.from(await doc.save());
};

const upload = async (token, bytes, filename) => {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: 'application/pdf' }), filename);
  const r = await fetch(`${API}/api/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const createJob = async (token, filePath, fileName, extra = {}) => {
  const codeRes = await fetch(`${API}/api/print-jobs/new-code`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  const { jobId } = await codeRes.json();
  const r = await fetch(`${API}/api/print-jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jobId, fileName, filePath, pageCount: 2, colorMode: 'bw', copies: 1,
      duplex: false, orientation: 'portrait', paperSize: 'a4', pageRange: 'all',
      price: 4, ...extra,
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (body?.jobId) jobIdsMade.push(body.jobId);
  return { status: r.status, body, jobId };
};

const lookup = async (code, releaseToken) => {
  const r = await fetch(`${API}/api/jobs/lookup/${code}`, {
    headers: releaseToken ? { 'X-Release-Token': releaseToken } : {},
  });
  return { status: r.status, session: r.headers.get('X-Job-Session'), body: await r.json().catch(() => ({})) };
};

try {
  await mkTeacher(EMAIL, EMPID, 'Flow Probe');
  await mkTeacher(EMAIL2, EMPID2, 'Other Probe');
  const token = await login(EMAIL);
  const token2 = await login(EMAIL2);

  // ─────────────────────────────────────────────────────────────────────
  section('THE NORMAL FLOW — can a member of staff actually print?');

  check('staff can sign in', !!token);
  const pdf = await makePdf(2);
  const up = await upload(token, pdf, 'exam-paper.pdf');
  check('upload accepted', up.status === 200, `status ${up.status}`);
  check('upload returns a file path', !!up.body.filePath);
  check('file path carries a download signature', /\?t=\d+\./.test(up.body.filePath || ''));

  const job = await createJob(token, up.body.filePath, 'exam-paper.pdf');
  check('print job created', job.status === 201 || job.status === 200, `status ${job.status}`);
  printCode = job.jobId;
  check('a 6-digit print code was issued', /^\d{6}$/.test(printCode || ''), printCode);

  const look = await lookup(printCode);
  check('kiosk finds the job by code', look.status === 200 && Array.isArray(look.body) && look.body.length > 0);
  check('kiosk is handed a job-session token', !!look.session);
  const jobRow = Array.isArray(look.body) ? look.body[0] : look.body;
  check('normal job shows its file name', jobRow?.fileName === 'exam-paper.pdf', jobRow?.fileName);
  check('file path is NOT sent to the kiosk', jobRow?.filePath === undefined);
  check('wrapped key is NOT sent to the kiosk', jobRow?.wrappedKey === undefined);

  const det = await fetch(`${API}/api/jobs/${jobRow.id}/details`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Job-Session': look.session },
    body: JSON.stringify({ copies: 3 }),
  });
  check('kiosk can change copies', det.status === 200, `status ${det.status}`);

  const st = await fetch(`${API}/api/jobs/${printCode}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Job-Session': look.session },
    body: JSON.stringify({ status: 'printing' }),
  });
  check('kiosk can release the job to print', st.status === 200, `status ${st.status}`);

  const inDb = await PrintJob.findOne({ jobId: printCode }).lean();
  check('job is queued for the Pi (status=printing)', inDb?.status === 'printing', inDb?.status);
  check('copies change persisted', inDb?.copies === 3, inDb?.copies);
  check('the Pi has a file path to fetch', typeof inDb?.filePath === 'string' && inDb.filePath.length > 0);

  const dl = await fetch(inDb.filePath.replace(/^https?:\/\/[^/]+/, API));
  check('the Pi can download the document', dl.status === 200, `status ${dl.status}`);
  const dlBytes = Buffer.from(await dl.arrayBuffer());
  check('downloaded document is a real PDF', dlBytes.subarray(0, 4).toString() === '%PDF');
  check('downloaded document is intact', dlBytes.length === pdf.length, `${dlBytes.length} vs ${pdf.length}`);

  // ─────────────────────────────────────────────────────────────────────
  section('CONFIDENTIAL FLOW — the exam-paper path');

  const cpdf = await makePdf(3);
  const cup = await upload(token, cpdf, 'CAT-2-Physics-QP.pdf');
  const cjob = await createJob(token, cup.body.filePath, 'CAT-2-Physics-QP.pdf', { confidential: true });
  confidentialCode = cjob.jobId;
  check('confidential job created', cjob.status === 201 || cjob.status === 200, `status ${cjob.status}`);

  const cLook = await lookup(confidentialCode);
  const cRow = Array.isArray(cLook.body) ? cLook.body[0] : cLook.body;
  check('code alone does NOT reveal the paper name', cRow?.fileName !== 'CAT-2-Physics-QP.pdf', cRow?.fileName);
  check('job is still flagged confidential to the kiosk', cRow?.confidential === true);

  const badFac = await fetch(`${API}/api/jobs/${confidentialCode}/verify-faculty`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ facultyId: 'NOT-THE-RIGHT-ID' }),
  });
  check('wrong faculty ID is refused', badFac.status === 401 || badFac.status === 403, `status ${badFac.status}`);

  const goodFac = await fetch(`${API}/api/jobs/${confidentialCode}/verify-faculty`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ facultyId: EMPID }),
  });
  const facBody = await goodFac.json().catch(() => ({}));
  check('correct faculty ID is accepted', goodFac.status === 200, `status ${goodFac.status}`);
  check('a release token is issued', !!facBody.token);

  const cLook2 = await lookup(confidentialCode, facBody.token);
  const cRow2 = Array.isArray(cLook2.body) ? cLook2.body[0] : cLook2.body;
  check('paper name appears once faculty is verified', cRow2?.fileName === 'CAT-2-Physics-QP.pdf', cRow2?.fileName);

  const cRelease = await fetch(`${API}/api/jobs/${confidentialCode}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Job-Session': cLook2.session },
    body: JSON.stringify({ status: 'printing', releaseToken: facBody.token }),
  });
  check('verified confidential job releases to print', cRelease.status === 200, `status ${cRelease.status}`);

  const cInDb = await PrintJob.findOne({ jobId: confidentialCode }).lean();
  check('confidential document is encrypted at rest', !!cInDb?.wrappedKey && !!cInDb?.encIv);
  const cDl = await fetch(cInDb.filePath.replace(/^https?:\/\/[^/]+/, API));
  const cBytes = Buffer.from(await cDl.arrayBuffer());
  check('stored bytes are NOT the original PDF', cBytes.subarray(0, 4).toString() !== '%PDF');
  check('the Pi has what it needs to decrypt', !!cInDb.encAuthTag && !!cInDb.wrappedKeyIv && !!cInDb.wrappedKeyAuthTag);

  // ─────────────────────────────────────────────────────────────────────
  section('ATTACK — a student with the print code');

  const noSess = await fetch(`${API}/api/jobs/${printCode}/status`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  check('cannot cancel a job with the code alone', noSess.status === 403, `status ${noSess.status}`);

  const delNoSess = await fetch(`${API}/api/jobs/${jobRow.id}`, { method: 'DELETE' });
  check('cannot delete a job with the code alone', delNoSess.status === 403, `status ${delNoSess.status}`);

  const cSess = await lookup(confidentialCode);
  const cDet = await fetch(`${API}/api/jobs/${cRow.id}/details`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Job-Session': cSess.session },
    body: JSON.stringify({ copies: 500 }),
  });
  check('cannot re-configure a confidential job unverified', cDet.status === 403, `status ${cDet.status}`);

  const cDel = await fetch(`${API}/api/jobs/${cRow.id}`, {
    method: 'DELETE', headers: { 'X-Job-Session': cSess.session },
  });
  check('cannot delete a confidential job unverified', cDel.status === 403, `status ${cDel.status}`);

  const cRel2 = await fetch(`${API}/api/jobs/${confidentialCode}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Job-Session': cSess.session },
    body: JSON.stringify({ status: 'printing' }),
  });
  check('cannot release a confidential job unverified', cRel2.status === 403, `status ${cRel2.status}`);

  // ─────────────────────────────────────────────────────────────────────
  section('ATTACK — anonymous and forged identity');

  const anon = [
    ['upload', await fetch(`${API}/api/upload`, { method: 'POST' })],
    ['create job', await fetch(`${API}/api/print-jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })],
    ['get a print code', await fetch(`${API}/api/print-jobs/new-code`, { method: 'POST' })],
    ['list every job', await fetch(`${API}/api/print-jobs`)],
    ['list staff', await fetch(`${API}/api/admin/teachers`)],
    ['change settings', await fetch(`${API}/api/admin/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"settings":[]}' })],
  ];
  for (const [what, r] of anon) check(`anonymous cannot ${what}`, r.status === 401, `status ${r.status}`);

  const spoof = await fetch(`${API}/api/print-jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token2}` },
    body: JSON.stringify({
      jobId: '999999', fileName: 'x.pdf', filePath: up.body.filePath, pageCount: 1,
      colorMode: 'bw', copies: 1, duplex: false, orientation: 'portrait',
      paperSize: 'a4', pageRange: 'all', price: 2, confidential: true,
      teacherEmpId: EMPID, teacherEmail: EMAIL, studentName: 'Flow Probe',
    }),
  });
  const spoofBody = await spoof.json().catch(() => ({}));
  if (spoofBody?.jobId) jobIdsMade.push(spoofBody.jobId);
  const spoofRow = spoofBody?.jobId ? await PrintJob.findOne({ jobId: spoofBody.jobId }).lean() : null;
  check('a spoofed faculty ID in the body is ignored', spoofRow?.teacherEmpId === EMPID2, spoofRow?.teacherEmpId);

  // Token confusion: each token type only works in its own scope.
  const adminWithTeacher = await fetch(`${API}/api/admin/teachers`, { headers: { Authorization: `Bearer ${token}` } });
  check('a staff token is not an admin token', adminWithTeacher.status === 401, `status ${adminWithTeacher.status}`);
  const uploadWithSession = await fetch(`${API}/api/upload`, { method: 'POST', headers: { Authorization: `Bearer ${look.session}` } });
  check('a job-session token is not a staff token', uploadWithSession.status === 401, `status ${uploadWithSession.status}`);

  // ─────────────────────────────────────────────────────────────────────
  section('ATTACK — injection and malformed input');

  const nosql = await fetch(`${API}/api/teacher/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: { $ne: null }, password: { $ne: null } }),
  });
  check('NoSQL operator injection on login refused', nosql.status === 400 || nosql.status === 401, `status ${nosql.status}`);

  const nosqlOtp = await fetch(`${API}/api/teacher/reset-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, otp: { $ne: null }, newPassword: 'attacker-chosen-pass' }),
  });
  check('NoSQL operator injection on reset refused', nosqlOtp.status === 400, `status ${nosqlOtp.status}`);
  const stillOk = await login(EMAIL);
  check('password was NOT changed by that attempt', !!stillOk);

  const badId = await fetch(`${API}/api/jobs/not-an-object-id/details`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  check('malformed job id is a 404, not a 500', badId.status === 404, `status ${badId.status}`);

  const badStatus = await fetch(`${API}/api/jobs/${printCode}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Job-Session': look.session },
    body: JSON.stringify({ status: 'pwned' }),
  });
  check('unknown status rejected', badStatus.status === 400, `status ${badStatus.status}`);

  const hugeCopies = await fetch(`${API}/api/jobs/${jobRow.id}/details`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Job-Session': look.session },
    body: JSON.stringify({ copies: 100000 }),
  });
  check('absurd copy count rejected', hugeCopies.status === 400, `status ${hugeCopies.status}`);

  const cmdName = await upload(token, await makePdf(1), 'reboot$(id);rm -rf.pdf');
  check('shell metacharacters in a file name are stripped, not executed',
    cmdName.status === 200, `status ${cmdName.status}`);
  check('stored name is a plain hash, not the supplied name',
    /\/uploads\/[a-f0-9]{64}\.pdf\?t=/.test(cmdName.body.filePath || ''),
    (cmdName.body.filePath || '').split('/').pop()?.slice(0, 16));

  // Content-based type check: the bytes decide, not what the caller claims.
  const lying = await upload(token, Buffer.from('#!/bin/sh\necho pwned\n'), 'invoice.pdf');
  check('non-PDF bytes rejected despite a .pdf name', lying.status === 400, `status ${lying.status}`);
  const lyingZip = await upload(token, Buffer.from('MZ\x90\x00 not an office file'), 'sheet.xlsx');
  check('an executable renamed .xlsx is rejected', lyingZip.status === 400, `status ${lyingZip.status}`);
  const realTxt = await upload(token, Buffer.from('a perfectly ordinary note\n'), 'notes.txt');
  check('a genuine text file is still accepted', realTxt.status === 200, `status ${realTxt.status}`);
  const binTxt = await upload(token, Buffer.from([0x00, 0x01, 0x02, 0x03]), 'notes.txt');
  check('binary claiming to be .txt is rejected', binTxt.status === 400, `status ${binTxt.status}`);

  const ssrf = await fetch(`${API}/api/print-jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jobId: '888888', fileName: 'x.pdf', filePath: 'http://169.254.169.254/latest/meta-data/',
      pageCount: 1, colorMode: 'bw', copies: 1, duplex: false, orientation: 'portrait',
      paperSize: 'a4', pageRange: 'all', price: 2,
    }),
  });
  check('the Pi cannot be pointed at an arbitrary URL', ssrf.status === 400, `status ${ssrf.status}`);

  const badType = await upload(token, Buffer.from('#!/bin/sh\necho pwned\n'), 'payload.sh');
  check('a shell script is rejected outright', badType.status === 400, `status ${badType.status}`);

  // ─────────────────────────────────────────────────────────────────────
  section('ATTACK — enumeration and disclosure');

  const unknownUser = await fetch(`${API}/api/teacher/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'definitely.not.here@example.com', password: 'whatever-at-all' }),
  });
  const knownUserBadPass = await fetch(`${API}/api/teacher/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: 'wrong-password-here' }),
  });
  const m1 = (await unknownUser.json().catch(() => ({}))).message;
  const m2 = (await knownUserBadPass.json().catch(() => ({}))).message;
  check('unknown and known accounts answer identically', unknownUser.status === knownUserBadPass.status && m1 === m2, `${m1} / ${m2}`);

  const forgot = await fetch(`${API}/api/teacher/forgot-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'definitely.not.here@example.com' }),
  });
  check('password reset does not reveal who exists', forgot.status === 200, `status ${forgot.status}`);

  const missingCode = await fetch(`${API}/api/jobs/lookup/000001`);
  check('an unused print code is a clean 404', missingCode.status === 404, `status ${missingCode.status}`);

  const bareFile = await fetch(`${API}${new URL(up.body.filePath).pathname}`);
  check('document needs its signature to download', bareFile.status === 403, `status ${bareFile.status}`);

  const tampered = await fetch(`${API}${new URL(up.body.filePath).pathname}?t=${'9'.repeat(13)}.${'a'.repeat(64)}`);
  check('forged download signature refused', tampered.status === 403, `status ${tampered.status}`);
} finally {
  section('CLEANUP');
  const jobsGone = await PrintJob.deleteMany({ jobId: { $in: jobIdsMade } });
  await Teacher.deleteMany({ email: { $in: [EMAIL, EMAIL2] } });
  check('test jobs removed', true, `${jobsGone.deletedCount} deleted`);
  check('test accounts removed', (await Teacher.countDocuments({ email: { $in: [EMAIL, EMAIL2] } })) === 0);
  check('no probe jobs left behind', (await PrintJob.countDocuments({ jobId: { $in: jobIdsMade } })) === 0);
  check('real staff accounts untouched', (await Teacher.countDocuments()) === 7, `${await Teacher.countDocuments()} accounts`);
  await mongoose.disconnect();
}

let pass = 0, fail = 0;
for (const s of sections) {
  console.log(`\n─── ${s.name} ───`);
  for (const r of s.rows) {
    r.pass ? pass++ : fail++;
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.label}${r.extra ? '  — ' + r.extra : ''}`);
  }
}
console.log(`\n════ ${pass} passed, ${fail} failed ════\n`);
