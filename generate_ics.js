#!/usr/bin/env node
/*
 * Erzeugt eine gueltige .ics-Kalenderdatei mit allen Saisonspielen eines
 * Teams von handball.net, da die Plattform keinen Kalender-Export mehr anbietet.
 *
 * Nutzung:
 *   node generate_ics.js <team-id-oder-url> [saison-startjahr]
 *
 * Beispiele:
 *   node generate_ics.js 81768
 *   node generate_ics.js https://www.handball.net/team/81768
 *   node generate_ics.js 81768 2025   (Saison 2025/2026 statt aktueller Saison)
 *
 * Der Ausgabedateiname enthaelt bewusst KEIN Saisonjahr, damit eine einmal
 * eingerichtete Kalender-Abo-URL auch ueber den Saisonwechsel hinweg stabil bleibt.
 */

const BASE = 'https://www.handball.net';
const MATCH_DURATION_MINUTES = 105; // Aufwaermen + 2x30 Min + Halbzeit + Puffer

function parseTeamId(input) {
  const m = String(input).match(/(\d+)\s*$/);
  if (!m) throw new Error(`Konnte keine Team-ID aus "${input}" lesen.`);
  return m[1];
}

async function getClientToken(teamId) {
  const res = await fetch(`${BASE}/team/${teamId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Team-Seite nicht erreichbar (HTTP ${res.status}).`);
  const html = await res.text();
  const m = html.match(/<meta name="client-token" content="([^"]+)"/);
  if (!m) throw new Error('Kein client-token in der Team-Seite gefunden.');
  return m[1];
}

async function apiGet(path, token, teamId) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'x-client-token': token,
      Referer: `${BASE}/team/${teamId}`,
    },
  });
  const json = await res.json();
  if (!res.ok || json.success === false) {
    throw new Error(`API-Fehler bei ${path}: ${JSON.stringify(json.error || json)}`);
  }
  return json;
}

async function fetchAllMatches(teamId, token, dateFrom, dateTo) {
  let page = 1;
  let all = [];
  while (true) {
    const json = await apiGet(
      `/api/new/matches?team_id=${teamId}&date_from=${dateFrom}&date_to=${dateTo}&page=${page}`,
      token,
      teamId
    );
    all = all.concat(json.data);
    if (!json.pagination || page >= json.pagination.last_page) break;
    page += 1;
  }
  return all;
}

// --- ICS Hilfsfunktionen ---------------------------------------------------

function icsEscape(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Nicht mitten in einem UTF-8 Multibyte-Zeichen trennen
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    out.push(bytes.slice(start, end).toString('utf8'));
    start = end;
    limit = 74; // Fortsetzungszeilen beginnen mit einem Leerzeichen (1 Byte)
  }
  return out.join('\r\n ');
}

function fmtLocalDateTime(isoLike) {
  // API liefert z.B. "2026-09-05T18:00:00+00:00" - der Offset ist irrefuehrend,
  // der HH:MM Teil ist die tatsaechliche lokale Uhrzeit in Europe/Berlin.
  const m = String(isoLike).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) throw new Error(`Unerwartetes Datumsformat: ${isoLike}`);
  const [, y, mo, d, h, mi, s] = m;
  return { y, mo, d, h, mi, s, compact: `${y}${mo}${d}T${h}${mi}${s}` };
}

function addMinutes(dt, minutesToAdd) {
  const base = new Date(Date.UTC(+dt.y, +dt.mo - 1, +dt.d, +dt.h, +dt.mi, +dt.s));
  base.setUTCMinutes(base.getUTCMinutes() + minutesToAdd);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${base.getUTCFullYear()}${pad(base.getUTCMonth() + 1)}${pad(base.getUTCDate())}` +
    `T${pad(base.getUTCHours())}${pad(base.getUTCMinutes())}${pad(base.getUTCSeconds())}`
  );
}

function buildLocation(match) {
  const field = match.field;
  if (!field) return '';
  const inst = field.installation;
  // inst.address enthaelt bereits PLZ/Ort (z.B. "Steenbarg 10, 24159 Kiel"),
  // daher NICHT zusaetzlich postal_code/city anhaengen.
  const parts = [field.name];
  if (inst?.address) parts.push(inst.address);
  return parts.filter(Boolean).join(', ');
}

function buildDescription(match, teamId) {
  const lines = [];
  const comp = match.phase?.competition?.name;
  const phase = match.phase?.name;
  if (comp) lines.push(`Wettbewerb: ${comp}`);
  if (phase && phase !== comp) lines.push(`Liga/Staffel: ${phase}`);

  const isHome = String(match.local?.id) === String(teamId);
  lines.push(isHome ? 'Heimspiel' : 'Auswärtsspiel');

  if (match.status?.is_finished && match.result) {
    lines.push(`Ergebnis: ${match.result.local ?? '-'}:${match.result.visitor ?? '-'}`);
  } else if (match.status?.name) {
    lines.push(`Status: ${match.status.name}`);
  }

  if (Array.isArray(match.referees) && match.referees.length > 0) {
    const refs = match.referees
      .map((r) => r.name || [r.first_name, r.last_name].filter(Boolean).join(' '))
      .filter(Boolean);
    if (refs.length) lines.push(`Schiedsrichter: ${refs.join(', ')}`);
  }

  lines.push(`Link: ${BASE}/match/${match.id}`);
  return lines.join('\n');
}

function matchToVEvent(match, teamId, dtstampCompact) {
  const start = fmtLocalDateTime(match.date);
  const dtstart = start.compact;
  const dtend = addMinutes(start, MATCH_DURATION_MINUTES);

  const home = match.local?.name || '?';
  const away = match.visitor?.name || '?';
  const isHome = String(match.local?.id) === String(teamId);
  const summary = `${home} - ${away}${isHome ? ' (Heim)' : ' (Auswärts)'}`;

  const statusName = (match.status?.name || '').toLowerCase();
  const icsStatus = /cancel|suspend|aufgeb|abgesagt/.test(statusName) ? 'CANCELLED' : 'CONFIRMED';

  const location = buildLocation(match);
  const description = buildDescription(match, teamId);

  const lines = [
    'BEGIN:VEVENT',
    `UID:handball-net-match-${match.id}@handball.net`,
    `DTSTAMP:${dtstampCompact}`,
    `DTSTART;TZID=Europe/Berlin:${dtstart}`,
    `DTEND;TZID=Europe/Berlin:${dtend}`,
    `SUMMARY:${icsEscape(summary)}`,
    `STATUS:${icsStatus}`,
  ];
  if (location) lines.push(`LOCATION:${icsEscape(location)}`);
  if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);

  const lat = parseFloat(match.field?.installation?.latitude);
  const lon = parseFloat(match.field?.installation?.longitude);
  if (lat && lon) lines.push(`GEO:${lat};${lon}`);

  lines.push('END:VEVENT');
  return lines;
}

const VTIMEZONE_EUROPE_BERLIN = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'X-LIC-LOCATION:Europe/Berlin',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

function buildCalendar(teamName, matches, teamId, season) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dtstamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const sorted = [...matches].sort((a, b) => a.date.localeCompare(b.date));

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//handball.net inoffizieller ICS-Export//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(teamName + ' Spielplan')}`,
    `X-WR-CALDESC:${icsEscape('Automatisch erzeugt von handball.net, ' + season.name)}`,
    'X-WR-TIMEZONE:Europe/Berlin',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
    ...VTIMEZONE_EUROPE_BERLIN,
  ];

  for (const match of sorted) {
    lines.push(...matchToVEvent(match, teamId, dtstamp));
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// --- Main --------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Nutzung: node generate_ics.js <team-id-oder-url> [saison-startjahr]');
    process.exit(1);
  }
  const teamId = parseTeamId(args[0]);
  const seasonStartYearArg = args[1] ? Number(args[1]) : null;

  console.log(`Lade Team ${teamId} von handball.net ...`);
  const token = await getClientToken(teamId);

  const teamInfo = await apiGet(`/api/new/teams/${teamId}`, token, teamId);
  const teamName = teamInfo.data.name;
  console.log(`Team: ${teamName}`);

  const seasonsRes = await apiGet('/api/new/seasons', token, teamId);
  let season;
  if (seasonStartYearArg) {
    season = seasonsRes.data.find((s) => s.start_date.startsWith(String(seasonStartYearArg)));
    if (!season) throw new Error(`Saison mit Startjahr ${seasonStartYearArg} nicht gefunden.`);
  } else {
    season = seasonsRes.data.find((s) => s.is_active) || seasonsRes.data[0];
  }
  console.log(`Saison: ${season.name} (${season.start_date} bis ${season.end_date})`);

  const matches = await fetchAllMatches(teamId, token, season.start_date, season.end_date);
  console.log(`${matches.length} Spiele gefunden.`);

  const ics = buildCalendar(teamName, matches, teamId, season);

  const safeName = teamName.replace(/[^a-zA-Z0-9äöüÄÖÜß]+/g, '_');
  const outFile = process.env.OUTPUT_FILE || `${safeName}_Spielplan.ics`;

  const fs = require('fs');
  const path = require('path');
  const outPath = path.join(__dirname, outFile);
  fs.writeFileSync(outPath, ics, 'utf8');
  console.log(`Geschrieben: ${outPath}`);
}

main().catch((err) => {
  console.error('Fehler:', err.message);
  process.exit(1);
});
