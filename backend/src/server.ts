import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();
const app = express();

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
    const { email, password } = req.body || {};
    const e = String(email || "").trim().toLowerCase();
    const p = String(password || "");
    if (!e || !p) return res.status(400).json({ error: "Email et mot de passe requis" });

    const user = await prisma.user.findUnique({ where: { email: e } });
    if (!user) return res.status(401).json({ error: "Identifiants invalides" });

    const ok = await bcrypt.compare(p, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Identifiants invalides" });

    const token = signAdminToken({ id: user.id, email: user.email });
    return res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, locale: user.locale },
    });
  } catch {
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

function dishImageUrl(filename: string): string {
  if (!filename) return "";
  if (filename.startsWith("http") || filename.startsWith("/")) return filename;
  return `/uploads/${path.basename(filename)}`;
}

function saveBase64Image(dataUrl: string): string {
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) throw new Error("Format image invalide");
  const ext = (match[1] === "jpeg" ? "jpg" : match[1]).toLowerCase();
  const base64 = match[2];
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

const CHECKIN_GRACE_MINUTES = 15;

function minutesFromHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function shouldBlockTableAtEvalTime(reservation: { status: string; checkedInAt: Date | null; startTime: string }, evalMinutes: number) {
  if (reservation.status === "EXPIRED" || reservation.status === "CANCELLED") return false;
  if (reservation.checkedInAt) return true;
  const start = minutesFromHHMM(reservation.startTime);
  return evalMinutes <= start + CHECKIN_GRACE_MINUTES;
}

// --- Routes ADMIN tables ---

// Liste de toutes les tables
app.get("/api/tables", async (_req, res) => {
  try {
    const tables = await prisma.table.findMany({
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
          busyUntil = r.endTime;
          break;
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

// Check-in via QR (QR fixe par table)
app.post("/api/checkin", async (req, res) => {
  try {
    const { tableId } = req.body || {};
    const id = Number(tableId);
    if (!id) return res.status(400).json({ error: "tableId requis" });

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const today = `${yyyy}-${mm}-${dd}`;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const reservations = await prisma.reservation.findMany({
      where: { tableId: id, date: today },
      orderBy: { startTime: "asc" },
    });

    const candidate = reservations.find((r) => {
      if (r.checkedInAt) return false;
      if (r.status === "EXPIRED" || r.status === "CANCELLED") return false;
      const start = minutesFromHHMM(r.startTime);
      return nowMinutes >= start && nowMinutes <= start + CHECKIN_GRACE_MINUTES;
    });

    if (!candidate) {
      return res.status(400).json({ error: "Aucune réservation à confirmer (hors délai ou inexistante)." });
    }

    await prisma.reservation.update({
      where: { id: candidate.id },
      data: { checkedInAt: now, status: "CHECKED_IN" },
    });

    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Erreur serveur" });
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

app.post("/api/dishes", requireAdmin, async (req, res) => {
  try {
    const { name: rawName, price: rawPrice, imageBase64, isQuick } = req.body || {};
    const name = (rawName != null ? String(rawName) : "").trim();
    const price = rawPrice != null ? parseFloat(String(rawPrice)) : NaN;

    if (!name) return res.status(400).json({ error: "Nom du plat requis" });
    if (Number.isNaN(price) || price < 0) return res.status(400).json({ error: "Prix invalide" });

    let imageUrl = "";
    if (imageBase64 && typeof imageBase64 === "string") {
      imageUrl = saveBase64Image(imageBase64);
    }
    const dish = await prisma.dish.create({
      data: { name, price, imageUrl, isQuick: Boolean(isQuick) },
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
    const { name: rawName, price: rawPrice, imageBase64, isQuick } = req.body || {};
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

    const dish = await prisma.dish.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
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

bootstrapAdminFromEnv()
  .catch(() => undefined)
  .finally(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`API running on port ${PORT}`);
    });
  });

