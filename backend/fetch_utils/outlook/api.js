const fetch = require("node-fetch");

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const FOLDER_PATH_SEPARATOR = "/";

async function graphJson(accessToken, pathOrUrl, init = {}) {
  const url = String(pathOrUrl).startsWith("http")
    ? pathOrUrl
    : `${GRAPH_BASE}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        `Microsoft Graph access denied (403).\n` +
          "For app-only flow, ensure:\n" +
          "1. Application permission Mail.ReadWrite (not Delegated).\n" +
          "2. Admin consent is granted for the tenant.\n" +
          "3. mailboxEmail is a real mailbox in the tenant.\n" +
          `Graph response: ${text}`
      );
    }
    const message =
      data?.error?.message ||
      data?.error_description ||
      `Microsoft Graph request failed (${response.status})`;
    throw new Error(message);
  }

  return data || {};
}

function userBasePath(mailboxEmail) {
  const email = String(mailboxEmail || "").trim();
  if (!email) {
    throw new Error("userBasePath: mailboxEmail is required.");
  }
  return `/users/${encodeURIComponent(email)}`;
}

function normalizeFolderReference(folderReference) {
  return String(folderReference || "")
    .replace(/\\/g, FOLDER_PATH_SEPARATOR)
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}

function normalizeFolderName(name) {
  return String(name || "").trim();
}

function isWellKnownFolderName(folderName) {
  const normalized = normalizeFolderName(folderName).toLowerCase();
  return ["inbox", "drafts", "sentitems", "deleteditems", "junkemail", "archive"].includes(
    normalized
  );
}

async function pagedGraphGet(accessToken, pathOrUrl, query = null) {
  const items = [];
  let nextUrl = pathOrUrl;
  let nextQuery = query;

  while (nextUrl) {
    let requestUrl = nextUrl;
    if (nextQuery) {
      const separator = requestUrl.includes("?") ? "&" : "?";
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(nextQuery)) {
        if (value != null) params.set(key, String(value));
      }
      requestUrl = `${requestUrl}${separator}${params.toString()}`;
    }

    const data = await graphJson(accessToken, requestUrl);
    items.push(...(data.value || []));
    nextUrl = data["@odata.nextLink"] || null;
    nextQuery = null;
  }

  return items;
}

async function listChildFolders(accessToken, mailboxEmail, parentFolderId = null) {
  const base = userBasePath(mailboxEmail);
  const path = parentFolderId
    ? `${base}/mailFolders/${encodeURIComponent(parentFolderId)}/childFolders`
    : `${base}/mailFolders`;

  return pagedGraphGet(accessToken, `${GRAPH_BASE}${path}`, {
    includeHiddenFolders: "true",
    $select: "id,displayName,parentFolderId,childFolderCount",
    $top: "100",
  });
}

async function listAllFolders(accessToken, mailboxEmail) {
  const folders = [];
  const foldersToCheck = [];

  for (const folder of await listChildFolders(accessToken, mailboxEmail)) {
    folder.path = folder.displayName || "";
    foldersToCheck.push(folder);
  }

  while (foldersToCheck.length) {
    const folder = foldersToCheck.shift();
    folders.push(folder);

    if (folder.childFolderCount > 0) {
      const children = await listChildFolders(accessToken, mailboxEmail, folder.id);
      for (const child of children) {
        child.path = [folder.path, child.displayName || ""].filter(Boolean).join(FOLDER_PATH_SEPARATOR);
        foldersToCheck.push(child);
      }
    }
  }

  return folders;
}

async function findFolderByReference(accessToken, mailboxEmail, folderReference) {
  const target = normalizeFolderName(folderReference);
  if (!target) {
    throw new Error("findFolderByReference: folderReference is required.");
  }

  if (isWellKnownFolderName(target) && !target.includes(FOLDER_PATH_SEPARATOR)) {
    const data = await graphJson(
      accessToken,
      `${userBasePath(mailboxEmail)}/mailFolders/${target.toLowerCase()}`
    );
    if (data?.id) {
      return {
        folderId: data.id,
        folderName: data.displayName || target,
        path: data.displayName || target,
      };
    }
  }

  const folders = await listAllFolders(accessToken, mailboxEmail);
  const normalizedReference = normalizeFolderReference(folderReference);
  const isPathReference =
    folderReference.includes(FOLDER_PATH_SEPARATOR) || folderReference.includes("\\");

  let matches;
  if (isPathReference) {
    matches = folders.filter(
      (folder) => normalizeFolderReference(folder.path || "") === normalizedReference
    );
  } else {
    matches = folders.filter(
      (folder) => String(folder.displayName || "").trim().toLowerCase() === target.toLowerCase()
    );
  }

  if (!matches.length) {
    const available = folders.map((f) => f.path || f.displayName).join("\n - ");
    throw new Error(
      `Outlook mail folder not found: "${folderReference}".\nAvailable folders:\n - ${available}`
    );
  }

  if (matches.length > 1) {
    const duplicatePaths = matches.map((f) => f.path).join("\n - ");
    throw new Error(
      `Multiple mail folders matched "${folderReference}". Use the full folder path.\nMatches:\n - ${duplicatePaths}`
    );
  }

  const folder = matches[0];
  return {
    folderId: folder.id,
    folderName: folder.displayName || target,
    path: folder.path || folder.displayName || target,
  };
}

async function resolveFolderIdByName(accessToken, mailboxEmail, folderName) {
  return findFolderByReference(accessToken, mailboxEmail, folderName);
}

async function listMessagesInFolder(accessToken, mailboxEmail, folderName, options = {}) {
  const { folderId, folderName: resolvedName } = await resolveFolderIdByName(
    accessToken,
    mailboxEmail,
    folderName
  );

  const rawLimit = options.maxMessages;
  const hasLimit =
    rawLimit != null &&
    rawLimit !== "" &&
    Number.isFinite(Number(rawLimit)) &&
    Number(rawLimit) > 0;
  const maxMessages = hasLimit ? Math.floor(Number(rawLimit)) : Infinity;

  const messages = [];
  const base = userBasePath(mailboxEmail);
  let nextLink = `${GRAPH_BASE}${base}/mailFolders/${encodeURIComponent(folderId)}/messages?$top=${hasLimit ? Math.min(maxMessages, 50) : 50}&$select=id,hasAttachments,receivedDateTime,subject`;

  while (nextLink && messages.length < maxMessages) {
    const data = await graphJson(accessToken, nextLink);
    messages.push(...(data.value || []));
    nextLink = data["@odata.nextLink"] || null;
    if (hasLimit && messages.length >= maxMessages) break;
  }

  return {
    folderId,
    folderName: resolvedName,
    messages: hasLimit ? messages.slice(0, maxMessages) : messages,
  };
}

function findPdfAttachment(attachments = []) {
  return (
    attachments.find((attachment) => {
      const contentType = String(attachment.contentType || "").toLowerCase();
      const name = String(attachment.name || "").toLowerCase();
      return (
        attachment["@odata.type"] === "#microsoft.graph.fileAttachment" &&
        (contentType === "application/pdf" || name.endsWith(".pdf"))
      );
    }) || null
  );
}

async function extractPdfAttachmentFromMessage(accessToken, mailboxEmail, messageId) {
  const base = userBasePath(mailboxEmail);
  const attachmentsData = await graphJson(
    accessToken,
    `${base}/messages/${encodeURIComponent(messageId)}/attachments?$top=50`
  );
  const attachment = findPdfAttachment(attachmentsData.value || []);
  if (!attachment) return null;

  let buffer = null;
  if (attachment.contentBytes) {
    buffer = Buffer.from(String(attachment.contentBytes), "base64");
  } else if (attachment.id) {
    const full = await graphJson(
      accessToken,
      `${base}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}`
    );
    if (full.contentBytes) {
      buffer = Buffer.from(String(full.contentBytes), "base64");
    }
  }

  if (!buffer || !buffer.length) return null;

  const filename = String(attachment.name || "").trim() || `${messageId}.pdf`;
  return {
    messageId,
    filename,
    buffer,
  };
}

async function moveMessageBetweenFolders(
  accessToken,
  mailboxEmail,
  messageId,
  fromFolderName,
  toFolderName
) {
  const { folderId: destinationId } = await resolveFolderIdByName(
    accessToken,
    mailboxEmail,
    toFolderName
  );
  const base = userBasePath(mailboxEmail);

  return graphJson(accessToken, `${base}/messages/${encodeURIComponent(messageId)}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ destinationId }),
  });
}

module.exports = {
  graphJson,
  userBasePath,
  resolveFolderIdByName,
  findFolderByReference,
  listMessagesInFolder,
  extractPdfAttachmentFromMessage,
  moveMessageBetweenFolders,
};
