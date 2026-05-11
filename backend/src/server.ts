import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { DEV_TEST_RESTAURATEUR } from "./devTestCredentials";

const prisma = new PrismaClient();
const app = express();

/** SQLite : unicité sensible à la casse ; on uniformise pour que findUnique(login) marche. */
async function normalizeAllUserEmails() {
  try {
    await prisma.$connect();
    await prisma.$executeRawUnsafe(`UPDATE "User" SET email = lower(trim(email))`);
  } catch (e) {
    console.warn("normalizeAllUserEmails:", e);
  }
}

/** Crée / met à jour le compte défini dans devTestCredentials.ts (démarrage + login). */
async function upsertBuiltinTestAdmin() {
  await normalizeAllUserEmails();
  const email = DEV_TEST_RESTAURATEUR.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(DEV_TEST_RESTAURATEUR.password, 10);
  const { name, locale } = DEV_TEST_RESTAURATEUR;
  await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, name, locale },
    update: { passwordHash, name, locale },
  });
}

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(UPLOAD_DIR));

app.get("/api", (_req, res) => {
  return res.json({ ok: true, service: "restaurant-kiosk-backend" });
});

app.get("/api/health", (_req, res) => {
  return res.json({ ok: true });
});

app.get("/api/debug", (_req, res) => {
  const commit =
    process.env.GIT_COMMIT ||
    process.env.BUILD_COMMIT ||
    process.env.GITHUB_SHA ||
    process.env.CI_COMMIT_SHA ||
    "";

  const disableAuth =
    String(process.env.DISABLE_AUTH || "").trim() === "1" ||
    String(process.env.DISABLE_AUTH || "").trim().toLowerCase() === "true";

  const emailOnlyLogin =
    String(process.env.EMAIL_ONLY_LOGIN || "").trim() === "1" ||
    String(process.env.EMAIL_ONLY_LOGIN || "").trim().toLowerCase() === "true";

  const dbUrl = String(process.env.DATABASE_URL || "");
  const dbDriver = dbUrl.startsWith("file:")
    ? "sqlite"
    : dbUrl.startsWith("postgres")
      ? "postgresql"
      : dbUrl
        ? "other"
        : "unset";

  return res.json({
    ok: true,
    service: "restaurant-kiosk-backend",
    commit,
    dbDriver,
    features: { disableAuth, emailOnlyLogin },
  });
});

const DEFAULT_SLOT_DURATION_MINUTES = 120;

function parseDurationMinutes(raw: unknown): number {
  const n = raw == null ? NaN : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SLOT_DURATION_MINUTES;
  // borne simple pour éviter n'importe quoi
  if (n < 15) return 15;
  if (n > 240) return 240;
  // arrondi au quart d'heure
  return Math.round(n / 15) * 15;
}

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES_IN = "7d";
const EMAIL_ONLY_LOGIN =
  String(process.env.EMAIL_ONLY_LOGIN || "").trim() === "1" ||
  String(process.env.EMAIL_ONLY_LOGIN || "").trim().toLowerCase() === "true";

type AdminJwtPayload = { sub: number; email: string };

function signAdminToken(user: { id: number; email: string }) {
  const payload: AdminJwtPayload = { sub: user.id, email: user.email };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function isAdminJwtPayload(value: unknown): value is AdminJwtPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as { sub?: unknown; email?: unknown };
  return typeof v.sub === "number" && Number.isFinite(v.sub) && typeof v.email === "string";
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const disableAuth =
    String(process.env.DISABLE_AUTH || "").trim() === "1" ||
    String(process.env.DISABLE_AUTH || "").trim().toLowerCase() === "true";
  if (disableAuth) {
    (req as any).adminUserId = 0;
    return next();
  }
  const auth = String(req.header("authorization") || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1];
  if (!token) return res.status(401).json({ error: "Non autorisé" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!isAdminJwtPayload(decoded)) {
      return res.status(401).json({ error: "Non autorisé" });
    }
    (req as any).adminUserId = decoded.sub;
    return next();
  } catch {
    return res.status(401).json({ error: "Non autorisé" });
  }
}

// Setup initial (1 seul compte restaurateur au départ)
app.post("/api/admin/setup", async (req, res) => {
  try {
    const count = await prisma.user.count();
    if (count > 0) {
      return res.status(400).json({ error: "Setup déjà effectué" });
    }
    const { email, password, name, locale } = req.body || {};
    const e = String(email || "").trim().toLowerCase();
    const p = String(password || "");
    const n = String(name || "Restaurateur").trim() || "Restaurateur";
    const l = String(locale || "fr").trim() || "fr";

    if (!e || !e.includes("@")) return res.status(400).json({ error: "Email invalide" });
    if (!p || p.length < 6) return res.status(400).json({ error: "Mot de passe trop court (min 6)" });

    const passwordHash = await bcrypt.hash(p, 10);
    const user = await prisma.user.create({
      data: { email: e, passwordHash, name: n, locale: l },
      select: { id: true, email: true, name: true, locale: true },
    });
    const token = signAdminToken({ id: user.id, email: user.email });
    return res.status(201).json({ token, user });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Erreur serveur" });
  }
});

app.post("/api/admin/login", async (req, res) => {
  try {
    await normalizeAllUserEmails();

    const { email, password } = req.body || {};
    const e = String(email || "").trim().toLowerCase();
    const p = String(password ?? "").trim();
    if (!e) return res.status(400).json({ error: "Email requis" });

    const builtinEmail = DEV_TEST_RESTAURATEUR.email.trim().toLowerCase();
    if (e === builtinEmail) {
      try {
        await upsertBuiltinTestAdmin();
      } catch (syncErr: any) {
        console.error("upsert compte test au login:", syncErr?.message || syncErr);
        return res.status(503).json({ error: "Base de données indisponible (vérifiez DATABASE_URL et Prisma)." });
      }
    }

    const user = await prisma.user.findUnique({ where: { email: e } });
    if (!user) {
      // Mode "email only": si le compte n'existe pas, on le crée.
      if (EMAIL_ONLY_LOGIN) {
        const passwordHash = await bcrypt.hash(`email-only:${Date.now()}`, 10);
        const created = await prisma.user.create({
          data: { email: e, passwordHash, name: "Restaurateur", locale: "fr" },
        });
        const token = signAdminToken({ id: created.id, email: created.email });
        return res.json({
          token,
          user: { id: created.id, email: created.email, name: created.name, locale: created.locale },
        });
      }
      return res.status(401).json({ error: "Identifiants invalides" });
    }

    // Mode email-only : mot de passe facultatif
    if (!EMAIL_ONLY_LOGIN) {
      if (!p) return res.status(400).json({ error: "Mot de passe requis" });
      const builtinEm = DEV_TEST_RESTAURATEUR.email.trim().toLowerCase();
      const builtinPw = DEV_TEST_RESTAURATEUR.password;
      const matchesBuiltin = e === builtinEm && p === builtinPw;
      const ok = matchesBuiltin || (await bcrypt.compare(p, user.passwordHash));
      if (!ok) return res.status(401).json({ error: "Identifiants invalides" });
    }

    const token = signAdminToken({ id: user.id, email: user.email });
    return res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, locale: user.locale },
    });
  } catch (err) {
    console.error("POST /api/admin/login", err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/admin/me", requireAdmin, async (req, res) => {
  try {
    const id = Number((req as any).adminUserId);
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, locale: true },
    });
    if (!user) return res.status(401).json({ error: "Non autorisé" });
    return res.json(user);
  } catch {
    return res.status(500).json({ error: "Erreur serveur" });
  }
});

/** URL publique du backend (pour que les images /uploads s’affichent depuis Vercel ou d’autres domaines). */
function publicBackendBase(): string {
  return String(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "")
    .trim()
    .replace(/\/+$/, "");
}

function dishImageUrl(filename: string): string {
  if (!filename) return "";
  if (filename.startsWith("http://") || filename.startsWith("https://")) return filename;
  const rel = filename.startsWith("/uploads/")
    ? filename
    : `/uploads/${path.basename(filename)}`;
  const base = publicBackendBase();
  if (base) return `${base}${rel}`;
  return rel;
}

function saveBase64Image(dataUrl: string): string {
  const idx = dataUrl.indexOf(";base64,");
  if (idx === -1) throw new Error("Format image invalide");
  const header = dataUrl.slice(0, idx).toLowerCase();
  if (!header.startsWith("data:image/")) throw new Error("Format image invalide");
  const base64 = dataUrl.slice(idx + ";base64,".length);
  const mime = header.replace(/^data:image\//, "").split(";")[0].trim();
  let ext = mime.split("+")[0].split("/").pop() || "png";
  if (ext === "jpeg") ext = "jpg";
  ext = ext.replace(/[^a-z0-9]/g, "") || "png";
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const filename = `dish-${unique}.${ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filepath, Buffer.from(base64, "base64"));
  return filename;
}

const isOverlapping = (
  startA: number,
  endA: number,
  startB: number,
  endB: number
) => startA < endB && startB < endA;

function minutesFromHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function shouldBlockTableAtEvalTime(reservation: { status: string }, _evalMinutes: number) {
  // Une réservation bloque la table sur toute sa durée, qu'il y ait eu check-in ou non.
  // Le "grace period" ne sert qu'à autoriser un check-in, pas à libérer la table.
  return reservation.status !== "EXPIRED" && reservation.status !== "CANCELLED";
}

function maxTimeHHMM(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return minutesFromHHMM(a) >= minutesFromHHMM(b) ? a : b;
}

// --- Routes ADMIN tables ---

// Liste de toutes les tables
app.get("/api/tables", async (_req, res) => {
  try {
    const tables = await prisma.table.findMany({
      where: { isActive: true },
      orderBy: { id: "asc" },
    });
    return res.json(tables);
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Création d'une table
app.post("/api/tables", requireAdmin, async (req, res) => {
  try {
    const { name, capacity, posX, posY, shape } = req.body;

    if (!name || !capacity) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const table = await prisma.table.create({
      data: {
        name,
        capacity,
        posX: posX ?? 50,
        posY: posY ?? 50,
        shape: shape ?? "SQUARE",
      },
    });

    return res.status(201).json(table);
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Mise à jour d'une table (position, capacité, etc.)
app.put("/api/tables/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, capacity, posX, posY, shape, isActive } = req.body;

    const table = await prisma.table.update({
      where: { id },
      data: {
        name,
        capacity,
        posX,
        posY,
        shape,
        isActive,
      },
    });

    return res.json(table);
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Suppression logique d'une table
app.delete("/api/tables/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const table = await prisma.table.update({
      where: { id },
      data: { isActive: false },
    });

    return res.json(table);
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/availability", async (req, res) => {
  try {
    const { date, time, guests, durationMinutes } = req.query;

    if (!date || !time || !guests) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const guestCount = Number(guests);

    const tables = await prisma.table.findMany({
      where: { isActive: true, capacity: { gte: guestCount } },
    });

    const reservations = await prisma.reservation.findMany({
      where: { date: String(date) },
    });

    const [hour, minute] = String(time).split(":").map(Number);
    const startMinutes = hour * 60 + minute;
    const endMinutes = startMinutes + parseDurationMinutes(durationMinutes);

    const availableTables = tables.filter((table) => {
      const resForTable = reservations.filter((r) => r.tableId === table.id);

      return !resForTable.some((r) => {
        const [sh, sm] = r.startTime.split(":").map(Number);
        const [eh, em] = r.endTime.split(":").map(Number);
        const rStart = sh * 60 + sm;
        const rEnd = eh * 60 + em;
        if (!shouldBlockTableAtEvalTime(r, startMinutes)) return false;
        return isOverlapping(startMinutes, endMinutes, rStart, rEnd);
      });
    });

    return res.json(availableTables);
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Statut des tables pour un créneau : libre ou occupée, avec heure de fin
app.get("/api/plan-status", async (req, res) => {
  try {
    const { date, time, guests, durationMinutes } = req.query;

    if (!date || !time || !guests) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const guestCount = Number(guests);

    const tables = await prisma.table.findMany({
      where: { isActive: true, capacity: { gte: guestCount } },
      orderBy: { id: "asc" },
    });

    const reservations = await prisma.reservation.findMany({
      where: { date: String(date) },
    });

    const [hour, minute] = String(time).split(":").map(Number);
    const startMinutes = hour * 60 + minute;
    const endMinutes = startMinutes + parseDurationMinutes(durationMinutes);

    const result = tables.map((table) => {
      const resForTable = reservations.filter((r) => r.tableId === table.id);

      let status: "free" | "busy" = "free";
      let busyUntil: string | null = null;

      for (const r of resForTable) {
        const [sh, sm] = r.startTime.split(":").map(Number);
        const [eh, em] = r.endTime.split(":").map(Number);
        const rStart = sh * 60 + sm;
        const rEnd = eh * 60 + em;
        if (!shouldBlockTableAtEvalTime(r, startMinutes)) continue;
        if (isOverlapping(startMinutes, endMinutes, rStart, rEnd)) {
          status = "busy";
          busyUntil = maxTimeHHMM(busyUntil, r.endTime);
        }
      }

      return {
        ...table,
        status,
        busyUntil,
      };
    });

    return res.json(result);
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/reservations", async (req, res) => {
  try {
    const { tableId, date, time, guestName, guestCount, durationMinutes } = req.body;

    if (!tableId || !date || !time || !guestName || !guestCount) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const [hour, minute] = time.split(":").map(Number);
    const startMinutes = hour * 60 + minute;
    const endMinutes = startMinutes + parseDurationMinutes(durationMinutes);
    const endHour = Math.floor(endMinutes / 60);
    const endMinute = endMinutes % 60;
    const endTime = `${String(endHour).padStart(2, "0")}:${String(
      endMinute
    ).padStart(2, "0")}`;

    const reservation = await prisma.reservation.create({
      data: {
        tableId,
        date,
        startTime: time,
        endTime,
        guestName,
        guestCount,
        status: "PENDING",
      },
    });

    return res.status(201).json(reservation);
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- Plats / Menu (JSON + base64 image, pas de multipart) ---

app.get("/api/dishes", async (_req, res) => {
  try {
    const dishes = await prisma.dish.findMany({ orderBy: { id: "asc" } });
    const withUrl = dishes.map((d) => ({
      ...d,
      imageUrl: d.imageUrl ? dishImageUrl(d.imageUrl) : "",
    }));
    return res.json(withUrl);
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
});

function trimStr(v: unknown): string {
  return v != null ? String(v).trim() : "";
}

app.post("/api/dishes", requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const { name: rawName, price: rawPrice, imageBase64, isQuick } = body;
    const name = trimStr(rawName);
    const nameEn = trimStr(body.nameEn);
    const nameNl = trimStr(body.nameNl);
    const nameEs = trimStr(body.nameEs);
    const price = rawPrice != null ? parseFloat(String(rawPrice)) : NaN;

    if (!name) return res.status(400).json({ error: "Nom du plat requis" });
    if (Number.isNaN(price) || price < 0) return res.status(400).json({ error: "Prix invalide" });

    let imageUrl = "";
    if (imageBase64 && typeof imageBase64 === "string") {
      imageUrl = saveBase64Image(imageBase64);
    }
    const dish = await prisma.dish.create({
      data: { name, nameEn, nameNl, nameEs, price, imageUrl, isQuick: Boolean(isQuick) },
    });
    return res.status(201).json({ ...dish, imageUrl: dishImageUrl(imageUrl) });
  } catch (e: any) {
    console.error("POST /api/dishes", e);
    return res.status(500).json({ error: e?.message || "Erreur création du plat" });
  }
});

app.put("/api/dishes/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    const { name: rawName, price: rawPrice, imageBase64, isQuick } = body;
    const existing = await prisma.dish.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Plat introuvable" });

    let imageUrl = existing.imageUrl;
    if (imageBase64 && typeof imageBase64 === "string") {
      if (existing.imageUrl) {
        const oldPath = path.join(UPLOAD_DIR, path.basename(existing.imageUrl));
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      imageUrl = saveBase64Image(imageBase64);
    }

    const name = rawName != null ? String(rawName).trim() : undefined;
    const price = rawPrice != null ? parseFloat(String(rawPrice)) : undefined;
    const nameEn = body.nameEn !== undefined ? trimStr(body.nameEn) : undefined;
    const nameNl = body.nameNl !== undefined ? trimStr(body.nameNl) : undefined;
    const nameEs = body.nameEs !== undefined ? trimStr(body.nameEs) : undefined;

    const dish = await prisma.dish.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(nameEn !== undefined && { nameEn }),
        ...(nameNl !== undefined && { nameNl }),
        ...(nameEs !== undefined && { nameEs }),
        ...(price !== undefined && !Number.isNaN(price) && { price }),
        ...(isQuick !== undefined && { isQuick: Boolean(isQuick) }),
        imageUrl,
      },
    });
    return res.json({ ...dish, imageUrl: dishImageUrl(dish.imageUrl) });
  } catch (e: any) {
    console.error("PUT /api/dishes", e);
    return res.status(500).json({ error: e?.message || "Erreur modification du plat" });
  }
});

app.delete("/api/dishes/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.dish.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Plat introuvable" });
    if (existing.imageUrl) {
      const p = path.join(UPLOAD_DIR, path.basename(existing.imageUrl));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    await prisma.dish.delete({ where: { id } });
    return res.status(204).send();
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = (() => {
  const raw = process.env.PORT;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 4000;
})();

async function bootstrapAdminFromEnv() {
  const emailRaw = process.env.ADMIN_EMAIL;
  const passwordRaw = process.env.ADMIN_PASSWORD;
  const nameRaw = process.env.ADMIN_NAME;
  const localeRaw = process.env.ADMIN_LOCALE;

  if (!emailRaw || !passwordRaw) return;

  const email = String(emailRaw).trim().toLowerCase();
  const password = String(passwordRaw);
  const name = String(nameRaw || "Restaurateur").trim() || "Restaurateur";
  const locale = String(localeRaw || "fr").trim() || "fr";

  if (!email.includes("@")) {
    console.warn("ADMIN_EMAIL invalide: bootstrap ignoré.");
    return;
  }
  if (password.length < 6) {
    console.warn("ADMIN_PASSWORD trop court (<6): bootstrap ignoré.");
    return;
  }

  try {
    const count = await prisma.user.count();
    if (count > 0) return;

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: { email, passwordHash, name, locale },
    });
    console.log("Compte admin initial créé via variables d'environnement.");
  } catch (e: any) {
    console.error("Bootstrap admin env échoué:", e?.message || e);
  }
}

/**
 * Crée ou met à jour le compte défini dans devTestCredentials.ts pour qu’il corresponde
 * toujours au mot de passe du fichier (évite « Identifiants invalides » après un ancien hash).
 */
async function bootstrapDevTestAdmin() {
  try {
    await upsertBuiltinTestAdmin();
    console.log(
      `Compte restaurateur de test prêt (${DEV_TEST_RESTAURATEUR.email.trim().toLowerCase()}) — mot de passe : voir devTestCredentials.ts`
    );
  } catch (e: any) {
    console.error("Bootstrap compte test échoué:", e?.message || e);
  }
}

bootstrapAdminFromEnv()
  .then(() => bootstrapDevTestAdmin())
  .catch(() => undefined)
  .finally(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`API running on port ${PORT}`);
    });
  });

