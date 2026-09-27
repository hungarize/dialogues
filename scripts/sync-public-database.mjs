const API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";

const SOURCE_DATA_SOURCE_ID = "e343c100-4b97-4667-a655-ab9a9874337d";
const PUBLIC_DATABASE_ID = "235efaf6-758f-4d1c-b7a8-4c571ba57cc7";
const PUBLIC_DATA_SOURCE_ID = "0f80f753-790b-43a9-9feb-bcf74a5cbd45";

const SOURCE_PROPERTIES = {
  title: "Title",
  status: "Status",
  lastPublished: "Last published",
  patreonUrl: "Patreon URL",
  level: "Level",
  noteType: "Note type",
  languageNote: "Language note",
  tags: "Tags",
};

const PUBLIC_PROPERTIES = {
  title: "Title",
  patreonUrl: "Patreon URL",
  level: "Level",
  noteType: "Note type",
  languageNote: "Language note",
  tags: "Tags",
  sourcePageId: "Source Page ID",
};

const LEVEL_MAP = new Map([
  ["Elementary", "START | Elementary"],
  ["Pre-Intermediate", "CLASSIC | Pre-Inter"],
  ["Intermediate", "CLASSIC | Inter"],
  ["Upper-Intermediate", "CLASSIC | Upper"],
]);

const MONTHS = new Map([
  ["january", 1], ["february", 2], ["march", 3], ["april", 4],
  ["may", 5], ["june", 6], ["july", 7], ["august", 8],
  ["september", 9], ["october", 10], ["november", 11], ["december", 12],
]);

function normalizeText(value) {
  return String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function normalizeUrl(value) {
  const raw = normalizeText(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

function richTextPlain(items = []) {
  return items.map((item) => item.plain_text ?? item.text?.content ?? "").join("");
}

function propertyTitle(property) {
  return richTextPlain(property?.title);
}

function propertyText(property) {
  return richTextPlain(property?.rich_text);
}

function propertySelect(property) {
  return property?.select?.name ?? "";
}

function propertyStatus(property) {
  return property?.status?.name ?? "";
}

function propertyUrl(property) {
  return property?.url ?? "";
}

function propertyTags(property) {
  return (property?.multi_select ?? []).map((option) => option.name);
}

function propertyDate(property) {
  return property?.date?.start?.slice(0, 10) ?? "";
}

function canonicalPageId(id) {
  const compact = String(id ?? "").replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) return String(id ?? "");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function checkpointFromDescription(description) {
  const text = richTextPlain(description);
  const preferredLine = text
    .split(/\r?\n/)
    .find((line) => /last\s+(published|publish|sync|synced|updated?)/i.test(line));
  const haystacks = preferredLine ? [preferredLine, text] : [text];

  for (const haystack of haystacks) {
    const iso = haystack.match(/\b(20\d{2})[-./](0[1-9]|1[0-2])[-./](0[1-9]|[12]\d|3[01])\b/);
    if (iso) {
      return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, matchedText: iso[0] };
    }

    const words = haystack.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(20\d{2})\b/i);
    if (words) {
      const month = String(MONTHS.get(words[1].toLowerCase())).padStart(2, "0");
      const day = words[2].padStart(2, "0");
      return { date: `${words[3]}-${month}-${day}`, matchedText: words[0] };
    }
  }

  throw new Error("No checkpoint date was found in the public database description.");
}

function replaceCheckpoint(description, matchedText, nextDate) {
  const text = richTextPlain(description);
  if (!text.includes(matchedText)) {
    throw new Error("The checkpoint text changed before it could be updated.");
  }
  return text.replace(matchedText, nextDate);
}

function todayInBudapest(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function mappedLevel(sourceLevel) {
  const value = LEVEL_MAP.get(sourceLevel);
  if (!value) throw new Error(`Unsupported Level value: ${sourceLevel || "(empty)"}`);
  return value;
}

function publicNoteType(sourceNoteType) {
  const trimmed = normalizeText(sourceNoteType);
  return trimmed === "Expression" ? "Expression " : trimmed;
}

function sourceRecord(page) {
  const properties = page.properties ?? {};
  const status = propertyStatus(properties[SOURCE_PROPERTIES.status]);
  const lastPublished = propertyDate(properties[SOURCE_PROPERTIES.lastPublished]);
  const title = propertyTitle(properties[SOURCE_PROPERTIES.title]);

  if (status !== "Published") throw new Error(`Unexpected non-Published source page: ${page.id}`);
  if (!lastPublished) throw new Error(`Published source page has no Last published date: ${page.id}`);
  if (!title) throw new Error(`Published source page has no Title: ${page.id}`);

  return {
    pageId: canonicalPageId(page.id),
    title,
    lastPublished,
    patreonUrl: propertyUrl(properties[SOURCE_PROPERTIES.patreonUrl]),
    level: mappedLevel(propertySelect(properties[SOURCE_PROPERTIES.level])),
    noteType: publicNoteType(propertySelect(properties[SOURCE_PROPERTIES.noteType])),
    languageNote: propertyText(properties[SOURCE_PROPERTIES.languageNote]),
    tags: propertyTags(properties[SOURCE_PROPERTIES.tags]),
  };
}

function publicRecord(page) {
  const properties = page.properties ?? {};
  return {
    pageId: canonicalPageId(page.id),
    sourcePageId: canonicalPageId(propertyText(properties[PUBLIC_PROPERTIES.sourcePageId])),
    title: propertyTitle(properties[PUBLIC_PROPERTIES.title]),
    patreonUrl: propertyUrl(properties[PUBLIC_PROPERTIES.patreonUrl]),
    level: propertySelect(properties[PUBLIC_PROPERTIES.level]),
    noteType: propertySelect(properties[PUBLIC_PROPERTIES.noteType]),
    languageNote: propertyText(properties[PUBLIC_PROPERTIES.languageNote]),
    tags: propertyTags(properties[PUBLIC_PROPERTIES.tags]),
  };
}

function strictKey(record) {
  return [record.title, record.level, record.noteType, record.languageNote]
    .map(normalizeText)
    .join("\u001f");
}

function relaxedKey(record) {
  return [record.title, record.languageNote].map(normalizeText).join("\u001f");
}

function indexUnique(records, keyFn, { skipEmpty = false } = {}) {
  const index = new Map();
  for (const record of records) {
    const key = keyFn(record);
    if (skipEmpty && !key) continue;
    const existing = index.get(key);
    if (!existing) index.set(key, record);
    else index.set(key, null);
  }
  return index;
}

function sameStringArray(left, right) {
  const a = [...left].map(normalizeText).sort();
  const b = [...right].map(normalizeText).sort();
  return JSON.stringify(a) === JSON.stringify(b);
}

function differs(current, desired) {
  return normalizeText(current.title) !== normalizeText(desired.title)
    || normalizeUrl(current.patreonUrl) !== normalizeUrl(desired.patreonUrl)
    || normalizeText(current.level) !== normalizeText(desired.level)
    || normalizeText(current.noteType) !== normalizeText(desired.noteType)
    || normalizeText(current.languageNote) !== normalizeText(desired.languageNote)
    || !sameStringArray(current.tags, desired.tags)
    || canonicalPageId(current.sourcePageId) !== canonicalPageId(desired.pageId);
}

function textItem(content) {
  return content ? [{ type: "text", text: { content } }] : [];
}

function publicProperties(record) {
  return {
    [PUBLIC_PROPERTIES.title]: { type: "title", title: textItem(record.title) },
    [PUBLIC_PROPERTIES.patreonUrl]: { type: "url", url: record.patreonUrl || null },
    [PUBLIC_PROPERTIES.level]: { type: "select", select: record.level ? { name: record.level } : null },
    [PUBLIC_PROPERTIES.noteType]: { type: "select", select: record.noteType ? { name: record.noteType } : null },
    [PUBLIC_PROPERTIES.languageNote]: { type: "rich_text", rich_text: textItem(record.languageNote) },
    [PUBLIC_PROPERTIES.tags]: { type: "multi_select", multi_select: record.tags.map((name) => ({ name })) },
    [PUBLIC_PROPERTIES.sourcePageId]: { type: "rich_text", rich_text: textItem(record.pageId) },
  };
}

function maskToken(text) {
  return String(text).replace(/secret_[A-Za-z0-9_-]+/g, "secret_***");
}

async function notionRequest(path, { method = "GET", body } = {}) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN is not available.");

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const raw = await response.text();
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { message: raw }; }

  if (!response.ok) {
    throw new Error(`Notion API ${method} ${path} failed (${response.status}): ${maskToken(payload.message ?? raw)}`);
  }
  return payload;
}

async function queryAll(dataSourceId, body = {}) {
  const results = [];
  let cursor;
  do {
    const payload = await notionRequest(`/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: { ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
    });
    if (payload.request_status?.type === "incomplete") {
      throw new Error(`Notion query was incomplete: ${payload.request_status.incomplete_reason ?? "unknown reason"}`);
    }
    results.push(...payload.results.filter((result) => result.object === "page"));
    cursor = payload.has_more ? payload.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function updatePublicPage(pageId, record) {
  return notionRequest(`/pages/${pageId}`, {
    method: "PATCH",
    body: { properties: publicProperties(record) },
  });
}

async function createPublicPage(record) {
  return notionRequest("/pages", {
    method: "POST",
    body: {
      parent: { type: "data_source_id", data_source_id: PUBLIC_DATA_SOURCE_ID },
      properties: publicProperties(record),
    },
  });
}

async function updateDatabaseCheckpoint(currentDescription, matchedText, nextDate) {
  const updatedText = replaceCheckpoint(currentDescription, matchedText, nextDate);
  return notionRequest(`/databases/${PUBLIC_DATABASE_ID}`, {
    method: "PATCH",
    body: { description: textItem(updatedText) },
  });
}

function choosePublicMatch(source, indexes, usedPublicPageIds) {
  const candidates = [
    indexes.bySourcePageId.get(source.pageId),
    indexes.byPatreonUrl.get(normalizeUrl(source.patreonUrl)),
    indexes.byStrictKey.get(strictKey(source)),
    indexes.byRelaxedKey.get(relaxedKey(source)),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!usedPublicPageIds.has(candidate.pageId)) return candidate;
  }
  return null;
}

async function run() {
  const mode = process.env.SYNC_MODE || "dry-run";
  if (!["dry-run", "apply"].includes(mode)) throw new Error(`Unsupported SYNC_MODE: ${mode}`);

  const today = todayInBudapest();
  const publicDatabase = await notionRequest(`/databases/${PUBLIC_DATABASE_ID}`);
  const checkpoint = checkpointFromDescription(publicDatabase.description ?? []);

  if (checkpoint.date > today) {
    throw new Error(`Checkpoint ${checkpoint.date} is later than Budapest date ${today}.`);
  }

  console.log(`Mode: ${mode}`);
  console.log(`Sync window: ${checkpoint.date} through ${today} (Europe/Budapest, inclusive)`);
  console.log("Future-dated source pages are excluded by the Notion query filter.");

  const sourcePages = await queryAll(SOURCE_DATA_SOURCE_ID, {
    filter: {
      and: [
        { property: SOURCE_PROPERTIES.status, status: { equals: "Published" } },
        { property: SOURCE_PROPERTIES.lastPublished, date: { on_or_after: checkpoint.date } },
        { property: SOURCE_PROPERTIES.lastPublished, date: { on_or_before: today } },
      ],
    },
    sorts: [{ property: SOURCE_PROPERTIES.lastPublished, direction: "ascending" }],
  });

  const publicPages = await queryAll(PUBLIC_DATA_SOURCE_ID);
  const sources = sourcePages.map(sourceRecord);
  const publicRecords = publicPages.map(publicRecord);

  const indexes = {
    bySourcePageId: indexUnique(publicRecords, (record) => record.sourcePageId, { skipEmpty: true }),
    byPatreonUrl: indexUnique(publicRecords, (record) => normalizeUrl(record.patreonUrl), { skipEmpty: true }),
    byStrictKey: indexUnique(publicRecords, strictKey),
    byRelaxedKey: indexUnique(publicRecords, relaxedKey),
  };

  const usedPublicPageIds = new Set();
  const operations = [];

  for (const source of sources) {
    const match = choosePublicMatch(source, indexes, usedPublicPageIds);
    if (match) {
      usedPublicPageIds.add(match.pageId);
      if (differs(match, source)) operations.push({ type: "update", source, target: match });
      else operations.push({ type: "unchanged", source, target: match });
    } else {
      operations.push({ type: "create", source });
    }
  }

  const summary = operations.reduce((acc, operation) => {
    acc[operation.type] = (acc[operation.type] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Source rows in window: ${sources.length}`);
  console.log(`Public rows inspected for matching: ${publicRecords.length}`);
  console.log(`Planned: ${summary.create ?? 0} create, ${summary.update ?? 0} update, ${summary.unchanged ?? 0} unchanged`);

  for (const operation of operations.filter((item) => item.type !== "unchanged")) {
    console.log(`${operation.type.toUpperCase()}: ${operation.source.title} (${operation.source.lastPublished})`);
  }

  if (mode === "dry-run") {
    console.log("Dry run complete. No Notion pages or checkpoint were changed.");
    return;
  }

  let created = 0;
  let updated = 0;
  for (const operation of operations) {
    if (operation.type === "create") {
      await createPublicPage(operation.source);
      created += 1;
    } else if (operation.type === "update") {
      await updatePublicPage(operation.target.pageId, operation.source);
      updated += 1;
    }
  }

  await updateDatabaseCheckpoint(publicDatabase.description ?? [], checkpoint.matchedText, today);
  console.log(`Apply complete: ${created} created, ${updated} updated. Checkpoint advanced to ${today}.`);
}

function selfTest() {
  const description = [{ plain_text: "Last published: August 16, 2026" }];
  const checkpoint = checkpointFromDescription(description);
  if (checkpoint.date !== "2026-08-16") throw new Error("Checkpoint parser self-test failed.");
  if (mappedLevel("Intermediate") !== "CLASSIC | Inter") throw new Error("Level mapping self-test failed.");
  if (publicNoteType("Expression") !== "Expression ") throw new Error("Note type mapping self-test failed.");
  if (canonicalPageId("235efaf6758f4d1cb7a84c571ba57cc7") !== "235efaf6-758f-4d1c-b7a8-4c571ba57cc7") throw new Error("Page ID self-test failed.");
  if (normalizeUrl("https://www.patreon.com/posts/123/") !== "https://www.patreon.com/posts/123") throw new Error("URL normalisation self-test failed.");
  console.log("Self-test passed.");
}

if (process.argv.includes("--self-test")) selfTest();
else run().catch((error) => {
  console.error(maskToken(error.stack ?? error.message ?? error));
  process.exit(1);
});
