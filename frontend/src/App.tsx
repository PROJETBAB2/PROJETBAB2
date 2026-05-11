import React, { useEffect, useRef, useState } from "react";
import { DEV_TEST_RESTAURATEUR } from "./devTestCredentials";
// QR codes supprimés de l'UI restaurateur.

/** En prod (Vercel), définir VITE_API_BASE_URL = URL du backend Render, sans slash final. */
function apiUrl(path: string): string {
  const raw = String((import.meta as any).env?.VITE_API_BASE_URL || "").trim();
  const base = raw.replace(/\/+$/, "");
  if (!base) return path;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** URLs `/uploads/...` : en prod elles doivent viser le backend Render, pas le domaine Vercel. */
function dishImageSrc(url: string): string {
  const u = (url || "").trim();
  if (!u) return "";
  if (u.startsWith("data:")) return u;
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  if (u.startsWith("//")) return `https:${u}`;
  let rel = u;
  if (!rel.startsWith("/uploads/")) {
    if (rel.startsWith("uploads/")) rel = `/${rel}`;
    else {
      const file = rel.split(/[/\\]/).pop() || rel;
      rel = `/uploads/${file}`;
    }
  }
  return apiUrl(rel);
}

function useResetForm(resetTrigger: number, reset: () => void) {
  const prev = useRef(resetTrigger);
  const resetRef = useRef(reset);
  resetRef.current = reset;
  useEffect(() => {
    if (resetTrigger !== prev.current) {
      prev.current = resetTrigger;
      resetRef.current();
    }
  }, [resetTrigger]);
}

type BaseTable = {
  id: number;
  name: string;
  capacity: number;
  posX: number;
  posY: number;
  shape: string;
};

type PlanStatus = "free" | "busy";

type PlanTable = BaseTable & {
  status: PlanStatus;
  busyUntil: string | null;
};

type AvailabilityResponse = PlanTable[];
type Screen = "menu" | "now" | "later" | "dishes";
type Lang = "fr" | "en" | "nl" | "es";
type BookingEntry = "quick" | "standard" | null;

type Dish = {
  id: number;
  name: string;
  nameEn?: string;
  nameNl?: string;
  nameEs?: string;
  price: number;
  imageUrl: string;
  isQuick?: boolean;
};

function dishDisplayName(d: Dish, lang: Lang): string {
  const en = (d.nameEn ?? "").trim();
  const nl = (d.nameNl ?? "").trim();
  const es = (d.nameEs ?? "").trim();
  if (lang === "en" && en) return en;
  if (lang === "nl" && nl) return nl;
  if (lang === "es" && es) return es;
  return d.name;
}

function T4(lang: Lang, fr: string, en: string, nl: string, es: string): string {
  switch (lang) {
    case "en":
      return en;
    case "nl":
      return nl;
    case "es":
      return es;
    default:
      return fr;
  }
}

function shapeDisplay(lang: Lang, code: string): string {
  const u = code.toUpperCase();
  if (u === "SQUARE")
    return T4(lang, "Carrée", "Square", "Vierkant", "Cuadrada");
  if (u === "RECTANGLE")
    return T4(lang, "Rectangulaire", "Rectangle", "Rechthoekig", "Rectangular");
  return T4(lang, "Ronde", "Round", "Rond", "Redonda");
}

type AddDishFormProps = {
  t: Record<string, unknown>;
  lang: Lang;
  resetTrigger: number;
  onSuccess: () => void;
  onError: (message: string) => void;
};

const AddDishForm: React.FC<AddDishFormProps> = ({ t, lang, resetTrigger, onSuccess, onError }) => {
  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameNl, setNameNl] = useState("");
  const [nameEs, setNameEs] = useState("");
  const [price, setPrice] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [isQuick, setIsQuick] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setName("");
    setNameEn("");
    setNameNl("");
    setNameEs("");
    setPrice("");
    setImagePreview("");
    setIsQuick(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  useResetForm(resetTrigger, resetForm);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setImagePreview("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImagePreview(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const p = parseFloat(price);
    if (!n || Number.isNaN(p) || p < 0) {
      onError(t.fillAllFields as string);
      return;
    }
    const body: {
      name: string;
      nameEn: string;
      nameNl: string;
      nameEs: string;
      price: number;
      imageBase64?: string;
      isQuick?: boolean;
    } = {
      name: n,
      nameEn: nameEn.trim(),
      nameNl: nameNl.trim(),
      nameEs: nameEs.trim(),
      price: p,
      isQuick,
    };
    if (imagePreview.startsWith("data:")) body.imageBase64 = imagePreview;

    try {
      const token = typeof window !== "undefined" ? window.localStorage.getItem("adminToken") || "" : "";
      const headers = new Headers({ "Content-Type": "application/json" });
      if (token) headers.set("authorization", `Bearer ${token}`);
      const res = await fetch(apiUrl("/api/dishes"), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError((data as { error?: string }).error || (t.createDishError as string));
        return;
      }
      resetForm();
      onSuccess();
    } catch {
      onError(
        T4(
          lang,
          "Erreur réseau.",
          "Network error.",
          "Netwerkfout.",
          "Error de red."
        )
      );
    }
  };

  return (
    <form onSubmit={handleSubmit} className="dish-form add-dish-form">
      <label>
        {t.dishNameLabel as string}
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <p className="dish-i18n-hint" style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", color: "var(--muted)" }}>
        {t.dishI18nHint as string}
      </p>
      <label>
        {t.dishNameEnLabel as string}
        <input type="text" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
      </label>
      <label>
        {t.dishNameNlLabel as string}
        <input type="text" value={nameNl} onChange={(e) => setNameNl(e.target.value)} />
      </label>
      <label>
        {t.dishNameEsLabel as string}
        <input type="text" value={nameEs} onChange={(e) => setNameEs(e.target.value)} />
      </label>
      <label>
        {t.priceLabel as string}
        <input
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required
        />
      </label>
      <label>
        {t.imageLabel as string}{" "}
        <span className="optional">{t.optionalShort as string}</span>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={onFileChange} />
      </label>
      <label style={{ minWidth: 220 }}>
        {t.quickPrepLabel as string}
        <input
          type="checkbox"
          checked={isQuick}
          onChange={(e) => setIsQuick(e.target.checked)}
          style={{ width: 18, height: 18, marginTop: 10 }}
        />
      </label>
      {imagePreview && (
        <div className="dish-image-preview">
          <span>{t.imagePreview as string}</span>
          <img src={imagePreview} alt="" />
        </div>
      )}
      <button type="submit" className="btn primary">
        {t.addDish as string}
      </button>
    </form>
  );
};

export const App: React.FC = () => {
  const [date, setDate] = useState<string>("");
  const [time, setTime] = useState<string>("");
  const [guests, setGuests] = useState<number>(2);
  const [tables, setTables] = useState<AvailabilityResponse>([]);
  const [selectedTable, setSelectedTable] = useState<PlanTable | null>(null);
  const [name, setName] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [adminMode, setAdminMode] = useState<boolean>(false);
  const [adminLoginOpen, setAdminLoginOpen] = useState<boolean>(false);
  const [adminEmail, setAdminEmail] = useState<string>(() => DEV_TEST_RESTAURATEUR.email);
  const [adminPassword, setAdminPassword] = useState<string>(() => DEV_TEST_RESTAURATEUR.password);
  const [adminToken, setAdminToken] = useState<string>(
    typeof window !== "undefined" ? window.localStorage.getItem("adminToken") || "" : ""
  );
  const [allTables, setAllTables] = useState<BaseTable[]>([]);
  const [mergeHistory, setMergeHistory] = useState<Record<number, BaseTable[]>>(() => {
    try {
      const raw = window.localStorage.getItem("mergeHistory");
      if (!raw) return {};
      return JSON.parse(raw) as Record<number, BaseTable[]>;
    } catch {
      return {};
    }
  });
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(
    null
  );
  const [screen, setScreen] = useState<Screen>("menu");
  const [adminSelection, setAdminSelection] = useState<number[]>([]);
  const [lang, setLang] = useState<Lang>("fr");
  const [reservationDurationMinutes, setReservationDurationMinutes] = useState<number>(120);
  const [bookingEntry, setBookingEntry] = useState<BookingEntry>(null);

  const disableAuth =
    (typeof window !== "undefined" && (import.meta as any).env?.VITE_DISABLE_AUTH === "1") ||
    (typeof window !== "undefined" &&
      String((import.meta as any).env?.VITE_DISABLE_AUTH || "").toLowerCase() === "true");

  const emailOnlyLogin =
    (typeof window !== "undefined" && (import.meta as any).env?.VITE_EMAIL_ONLY_LOGIN === "1") ||
    (typeof window !== "undefined" &&
      String((import.meta as any).env?.VITE_EMAIL_ONLY_LOGIN || "").toLowerCase() === "true");

  useEffect(() => {
    if (disableAuth) {
      setAdminMode(true);
      setAdminLoginOpen(false);
    }
  }, [disableAuth]);

  const [dishes, setDishes] = useState<Dish[]>([]);
  const [adminDishes, setAdminDishes] = useState<Dish[]>([]);
  const [adminSection, setAdminSection] = useState<"tables" | "dishes">("tables");
  const [dishName, setDishName] = useState("");
  const [dishNameEn, setDishNameEn] = useState("");
  const [dishNameNl, setDishNameNl] = useState("");
  const [dishNameEs, setDishNameEs] = useState("");
  const [dishPrice, setDishPrice] = useState("");
  const [dishImagePreview, setDishImagePreview] = useState<string>("");
  const [dishIsQuick, setDishIsQuick] = useState<boolean>(false);
  const [editingDishId, setEditingDishId] = useState<number | null>(null);
  const [addFormKey, setAddFormKey] = useState(0);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  const timeOptions = (() => {
    const opts: string[] = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) {
        opts.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      }
    }
    return opts;
  })();

  const adminFetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers || undefined);
    if (adminToken) headers.set("authorization", `Bearer ${adminToken}`);
    const url = typeof input === "string" ? apiUrl(input) : input;
    return fetch(url, { ...init, headers });
  };

  const submitAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    try {
      const res = await fetch(apiUrl("/api/admin/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(adminEmail).trim(),
          password: adminPassword,
        }),
      });
      const raw = await res.text();
      let data: { error?: string; token?: string } = {};
      if (raw) {
        try {
          data = JSON.parse(raw) as { error?: string; token?: string };
        } catch {
          setMessage(
            res.ok
              ? T4(
                  lang,
                  "Réponse serveur invalide.",
                  "Invalid server response.",
                  "Ongeldige serverreactie.",
                  "Respuesta del servidor no válida."
                )
              : T4(
                  lang,
                  "L'API ne répond pas (JSON attendu). Lancez le backend : dossier backend, npm run dev (port 4000), puis le frontend en npm run dev.",
                  "The API did not return JSON. Start the backend (folder backend, npm run dev on port 4000), then the frontend with npm run dev.",
                  "De API gaf geen JSON terug. Start de backend (map backend, npm run dev op poort 4000), daarna de frontend met npm run dev.",
                  "La API no devolvió JSON. Inicie el backend (carpeta backend, npm run dev en el puerto 4000) y luego el frontend con npm run dev."
                )
          );
          return;
        }
      }
      if (!res.ok) {
        setMessage(
          (data as { error?: string }).error ||
            T4(
              lang,
              "Identifiants invalides.",
              "Invalid credentials.",
              "Ongeldige inloggegevens.",
              "Credenciales no válidas."
            )
        );
        return;
      }
      const token = (data as { token?: string }).token || "";
      if (!token) {
        setMessage(
          T4(
            lang,
            "Réponse serveur invalide.",
            "Invalid server response.",
            "Ongeldige serverreactie.",
            "Respuesta del servidor no válida."
          )
        );
        return;
      }
      setAdminToken(token);
      window.localStorage.setItem("adminToken", token);
      setAdminLoginOpen(false);
      setAdminMode(true);
    } catch {
      setMessage(
        T4(
          lang,
          "Erreur réseau. Le serveur est-il démarré ?",
          "Network error. Is the server running?",
          "Netwerkfout. Draait de server?",
          "Error de red. ¿Está el servidor en ejecución?"
        )
      );
    }
  };

  const t = {
    fr: {
      kioskTitle: "Borne de réservation",
      adminTitle: "Mode restaurateur",
      adminSubtitle: "Créez, placez et gérez les tables de votre salle.",
      addTable: "Ajouter une table",
      backToClient: "Revenir au mode client",
      tablesLabel: "Tables",
      tablesHelp: "Cliquez et faites glisser une table sur le plan.",
      mergeTables: "Fusionner les tables sélectionnées",
      delete: "Supprimer",
      date: "Date",
      time: "Heure",
      guests: "Nombre de personnes",
      bookNow: "Réserver pour maintenant",
      bookLater: "Réserver pour plus tard",
      viewPlanNow: "Voir le plan des tables (maintenant)",
      adminModeButton: "Mode restaurateur",
      seeAvailability: "Voir les tables disponibles",
      backToMenu: "Retour au menu",
      fillAllFields: "Merci de remplir tous les champs.",
      loadError: "Erreur lors du chargement des disponibilités.",
      loadNetworkError:
        "Impossible de joindre le serveur. Lancez le backend (port 4000) et vérifiez la base de données.",
      noTables: "Aucune table disponible pour ce créneau.",
      chooseTableAndName:
        "Merci de choisir une table et de saisir votre nom.",
      tableBusy: "Cette table est occupée pour ce créneau.",
      reservationError: "Erreur lors de la création de la réservation.",
      reservationOk: "Réservation confirmée, merci !",
      invalidCapacity: "Capacité invalide.",
      createTableError: "Erreur lors de la création de la table.",
      createDishError: "Erreur lors de la création du plat.",
      mergeNeedTwo: "Sélectionnez au moins deux tables à fusionner.",
      mergeError: "Erreur lors de la fusion des tables.",
      tableCapacity: (c: number) => `Capacité : ${c} pers.`,
      busyUntil: (h: string) => `Occupée jusqu'à ${h}`,
      yourName: "Votre nom :",
      confirmReservation: "Confirmer la réservation",
      noneYet: "Aucune table encore créée.",
      viewMenu: "Voir le menu",
      menuTitle: "Notre menu",
      dishNameLabel: "Nom du plat",
      priceLabel: "Prix (€)",
      addDish: "Ajouter un plat",
      saveDish: "Enregistrer le plat",
      editDish: "Modifier",
      imageLabel: "Photo du plat",
      imagePreview: "Aperçu",
      noDishesYet: "Aucun plat pour l'instant.",
      dishesSectionTitle: "Gestion des plats",
      manageDishes: "Menu / Plats",
      manageTables: "Les tables",
      quickPass: "Passage rapide",
      quickPrepLabel: "Préparation rapide",
      quickPrepBadge: "Rapide",
      firstFreeNow: "Première table disponible : maintenant",
      firstFreeIn: (min: number, at: string) =>
        `Première table disponible dans ${min} min (à ${at})`,
      bookingBannerQuick:
        "Passage rapide — la table est réservée pour 1 heure à partir de l’heure indiquée.",
      bookingBannerStandard:
        "Réserver maintenant — réservation classique : la table est réservée pour 2 heures à partir de l’heure indiquée.",
      optionalShort: "(optionnel)",
      dishI18nHint:
        "Noms EN / NL / ES : affichés quand le client choisit cette langue ; laisser vide pour réutiliser le nom principal.",
      dishNameEnLabel: "Nom (anglais)",
      dishNameNlLabel: "Nom (néerlandais)",
      dishNameEsLabel: "Nom (espagnol)",
      adminLoginTitle: "Accès restaurateur",
      adminLoginHelp:
        "Connexion réservée à la gestion des tables et du menu. Les clients peuvent consulter le menu sans compte.",
      adminEmailLabel: "Email",
      adminPasswordLabel: "Mot de passe",
      adminBtnLogin: "Se connecter",
      adminBtnCancel: "Annuler",
      adminSetupHint:
        "Compte intégré : voir les fichiers devTestCredentials.ts (backend + frontend). Sinon POST /api/admin/setup si la base est vide.",
      checkinTitle: "Enregistrement",
      checkinTableLine: (id: string | number) => `Table n°${id}`,
      checkinConfirm: "Confirmer la réservation",
      checkinBack: "Retour",
      landingKicker: "Fine dining",
      landingTitle: "Une expérience culinaire authentique vous attend",
      landingDesc:
        "Réservez une table en quelques secondes, découvrez notre menu, ou consultez le plan des tables.",
      brandTagline: "Restaurant",
      promptTableName: "Nom de la table (ex: T1) :",
      promptTableCapacity: "Capacité (ex: 4) :",
      promptTableShape: "Forme (r = ronde, c = carrée, rect = rectangulaire) :",
      guestsAbbr: "pers.",
      reservationTableHeading: (n: string) => `Table ${n}`,
      cancel: "Annuler",
      networkError: "Erreur réseau.",
    },
    en: {
      kioskTitle: "Reservation kiosk",
      adminTitle: "Manager mode",
      adminSubtitle: "Create, place and manage your tables.",
      addTable: "Add table",
      backToClient: "Back to customer mode",
      tablesLabel: "Tables",
      tablesHelp: "Click and drag a table on the floor plan.",
      mergeTables: "Merge selected tables",
      delete: "Delete",
      date: "Date",
      time: "Time",
      guests: "Number of guests",
      bookNow: "Book for now",
      bookLater: "Book for later",
      viewPlanNow: "View floor plan (now)",
      adminModeButton: "Manager mode",
      seeAvailability: "Show available tables",
      backToMenu: "Back to menu",
      fillAllFields: "Please fill in all fields.",
      loadError: "Error while loading availability.",
      loadNetworkError:
        "Cannot reach the server. Start the backend (port 4000) and check the database.",
      noTables: "No table available for this time.",
      chooseTableAndName: "Please choose a table and enter your name.",
      tableBusy: "This table is busy for this time slot.",
      reservationError: "Error while creating the reservation.",
      reservationOk: "Reservation confirmed, thank you!",
      invalidCapacity: "Invalid capacity.",
      createTableError: "Error while creating the table.",
      createDishError: "Error while creating the dish.",
      mergeNeedTwo: "Select at least two tables to merge.",
      mergeError: "Error while merging tables.",
      tableCapacity: (c: number) => `Capacity: ${c} guests`,
      busyUntil: (h: string) => `Busy until ${h}`,
      yourName: "Your name:",
      confirmReservation: "Confirm reservation",
      noneYet: "No table created yet.",
      viewMenu: "View menu",
      menuTitle: "Our menu",
      dishNameLabel: "Dish name",
      priceLabel: "Price (€)",
      addDish: "Add dish",
      saveDish: "Save dish",
      editDish: "Edit",
      imageLabel: "Dish photo",
      imagePreview: "Preview",
      noDishesYet: "No dishes yet.",
      dishesSectionTitle: "Dish management",
      manageDishes: "Menu / Dishes",
      manageTables: "Tables",
      quickPass: "Quick visit",
      quickPrepLabel: "Quick preparation",
      quickPrepBadge: "Quick",
      firstFreeNow: "First table available: now",
      firstFreeIn: (min: number, at: string) =>
        `First table available in ${min} min (at ${at})`,
      bookingBannerQuick: "Quick pass — your table is booked for 1 hour from the selected time.",
      bookingBannerStandard:
        "Book for now — standard reservation: your table is booked for 2 hours from the selected time.",
      optionalShort: "(optional)",
      dishI18nHint:
        "EN / NL / ES names: shown when the guest picks that language; leave blank to use the main name.",
      dishNameEnLabel: "Name (English)",
      dishNameNlLabel: "Name (Dutch)",
      dishNameEsLabel: "Name (Spanish)",
      adminLoginTitle: "Staff access",
      adminLoginHelp:
        "Sign in to manage tables and the menu. Guests can browse the menu without an account.",
      adminEmailLabel: "Email",
      adminPasswordLabel: "Password",
      adminBtnLogin: "Sign in",
      adminBtnCancel: "Cancel",
      adminSetupHint:
        "Built-in account: see devTestCredentials.ts (backend + frontend). Otherwise POST /api/admin/setup if the database is empty.",
      checkinTitle: "Check-in",
      checkinTableLine: (id: string | number) => `Table #${id}`,
      checkinConfirm: "Confirm reservation",
      checkinBack: "Back",
      landingKicker: "Fine dining",
      landingTitle: "An authentic culinary experience awaits",
      landingDesc:
        "Book a table in seconds, explore our menu, or view the floor plan.",
      brandTagline: "Restaurant",
      promptTableName: "Table name (e.g. T1):",
      promptTableCapacity: "Capacity (e.g. 4):",
      promptTableShape: "Shape (r = round, c = square, rect = rectangle):",
      guestsAbbr: "guests",
      reservationTableHeading: (n: string) => `Table ${n}`,
      cancel: "Cancel",
      networkError: "Network error.",
    },
    nl: {
      kioskTitle: "Reservatiezuil",
      adminTitle: "Beheerdermodus",
      adminSubtitle: "Maak, plaats en beheer de tafels van de zaal.",
      addTable: "Tafel toevoegen",
      backToClient: "Terug naar klantmodus",
      tablesLabel: "Tafels",
      tablesHelp: "Klik en sleep een tafel op het zaalplan.",
      mergeTables: "Geselecteerde tafels samenvoegen",
      delete: "Verwijderen",
      date: "Datum",
      time: "Tijd",
      guests: "Aantal personen",
      bookNow: "Nu reserveren",
      bookLater: "Later reserveren",
      viewPlanNow: "Zaalplan bekijken (nu)",
      adminModeButton: "Beheerdermodus",
      seeAvailability: "Beschikbare tafels tonen",
      backToMenu: "Terug naar menu",
      fillAllFields: "Gelieve alle velden in te vullen.",
      loadError: "Fout bij het laden van de beschikbaarheid.",
      loadNetworkError:
        "Kan de server niet bereiken. Start de backend (poort 4000) en controleer de database.",
      noTables: "Geen tafel beschikbaar voor dit tijdstip.",
      chooseTableAndName:
        "Gelieve een tafel te kiezen en uw naam in te vullen.",
      tableBusy: "Deze tafel is bezet voor dit tijdstip.",
      reservationError: "Fout bij het maken van de reservatie.",
      reservationOk: "Reservatie bevestigd, dank u!",
      invalidCapacity: "Ongeldige capaciteit.",
      createTableError: "Fout bij het aanmaken van de tafel.",
      createDishError: "Fout bij het aanmaken van het gerecht.",
      mergeNeedTwo: "Selecteer minstens twee tafels om samen te voegen.",
      mergeError: "Fout bij het samenvoegen van de tafels.",
      tableCapacity: (c: number) => `Capaciteit: ${c} personen`,
      busyUntil: (h: string) => `Bezet tot ${h}`,
      yourName: "Uw naam:",
      confirmReservation: "Reservatie bevestigen",
      noneYet: "Nog geen tafels aangemaakt.",
      viewMenu: "Menu bekijken",
      menuTitle: "Ons menu",
      dishNameLabel: "Naam van het gerecht",
      priceLabel: "Prijs (€)",
      addDish: "Gerecht toevoegen",
      saveDish: "Gerecht opslaan",
      editDish: "Bewerken",
      imageLabel: "Foto van het gerecht",
      imagePreview: "Voorvertoning",
      noDishesYet: "Nog geen gerechten.",
      dishesSectionTitle: "Beheer van gerechten",
      manageDishes: "Menu / Gerechten",
      manageTables: "Tafels",
      quickPass: "Snelle passage",
      quickPrepLabel: "Snelle bereiding",
      quickPrepBadge: "Snel",
      firstFreeNow: "Eerste tafel beschikbaar: nu",
      firstFreeIn: (min: number, at: string) =>
        `Eerste tafel beschikbaar over ${min} min (om ${at})`,
      bookingBannerQuick:
        "Snelle passage — uw tafel is 1 uur gereserveerd vanaf het gekozen tijdstip.",
      bookingBannerStandard:
        "Nu reserveren — klassieke reservatie: uw tafel is 2 uur gereserveerd vanaf het gekozen tijdstip.",
      optionalShort: "(optioneel)",
      dishI18nHint:
        "EN / NL / ES namen: getoond als de gast die taal kiest; leeg laten om de hoofdnaam te gebruiken.",
      dishNameEnLabel: "Naam (Engels)",
      dishNameNlLabel: "Naam (Nederlands)",
      dishNameEsLabel: "Naam (Spaans)",
      adminLoginTitle: "Toegang restaurateur",
      adminLoginHelp:
        "Aanmelden om tafels en het menu te beheren. Gasten kunnen het menu zonder account bekijken.",
      adminEmailLabel: "E-mail",
      adminPasswordLabel: "Wachtwoord",
      adminBtnLogin: "Aanmelden",
      adminBtnCancel: "Annuleren",
      adminSetupHint:
        "Ingebouwd account: zie devTestCredentials.ts (backend + frontend). Anders POST /api/admin/setup als de database leeg is.",
      checkinTitle: "Inchecken",
      checkinTableLine: (id: string | number) => `Tafel nr. ${id}`,
      checkinConfirm: "Reservatie bevestigen",
      checkinBack: "Terug",
      landingKicker: "Fine dining",
      landingTitle: "Een authentieke culinaire ervaring wacht op u",
      landingDesc:
        "Reserveer in enkele seconden een tafel, ontdek ons menu of bekijk het plattegrondplan.",
      brandTagline: "Restaurant",
      promptTableName: "Tafelnaam (bv. T1):",
      promptTableCapacity: "Capaciteit (bv. 4):",
      promptTableShape: "Vorm (r = rond, c = vierkant, rect = rechthoek):",
      guestsAbbr: "pers.",
      reservationTableHeading: (n: string) => `Tafel ${n}`,
      cancel: "Annuleren",
      networkError: "Netwerkfout.",
    },
    es: {
      kioskTitle: "Terminal de reservas",
      adminTitle: "Modo restaurador",
      adminSubtitle: "Crea, coloca y gestiona las mesas de la sala.",
      addTable: "Añadir mesa",
      backToClient: "Volver al modo cliente",
      tablesLabel: "Mesas",
      tablesHelp: "Haz clic y arrastra una mesa en el plano.",
      mergeTables: "Fusionar mesas seleccionadas",
      delete: "Eliminar",
      date: "Fecha",
      time: "Hora",
      guests: "Número de personas",
      bookNow: "Reservar para ahora",
      bookLater: "Reservar para más tarde",
      viewPlanNow: "Ver plano de mesas (ahora)",
      adminModeButton: "Modo restaurador",
      seeAvailability: "Ver mesas disponibles",
      backToMenu: "Volver al menú",
      fillAllFields: "Por favor completa todos los campos.",
      loadError: "Error al cargar la disponibilidad.",
      loadNetworkError:
        "No se puede contactar al servidor. Inicie el backend (puerto 4000) y compruebe la base de datos.",
      noTables: "No hay mesas disponibles para este horario.",
      chooseTableAndName:
        "Por favor elige una mesa e introduce tu nombre.",
      tableBusy: "Esta mesa está ocupada para este horario.",
      reservationError: "Error al crear la reserva.",
      reservationOk: "¡Reserva confirmada, gracias!",
      invalidCapacity: "Capacidad no válida.",
      createTableError: "Error al crear la mesa.",
      createDishError: "Error al crear el plato.",
      mergeNeedTwo: "Selecciona al menos dos mesas para fusionar.",
      mergeError: "Error al fusionar las mesas.",
      tableCapacity: (c: number) => `Capacidad: ${c} personas`,
      busyUntil: (h: string) => `Ocupada hasta las ${h}`,
      yourName: "Tu nombre:",
      confirmReservation: "Confirmar reserva",
      noneYet: "Todavía no hay mesas creadas.",
      viewMenu: "Ver menú",
      menuTitle: "Nuestro menú",
      dishNameLabel: "Nombre del plato",
      priceLabel: "Precio (€)",
      addDish: "Añadir plato",
      saveDish: "Guardar plato",
      editDish: "Editar",
      imageLabel: "Foto del plato",
      imagePreview: "Vista previa",
      noDishesYet: "Aún no hay platos.",
      dishesSectionTitle: "Gestión de platos",
      manageDishes: "Menú / Platos",
      manageTables: "Mesas",
      quickPass: "Paso rápido",
      quickPrepLabel: "Preparación rápida",
      quickPrepBadge: "Rápido",
      firstFreeNow: "Primera mesa disponible: ahora",
      firstFreeIn: (min: number, at: string) =>
        `Primera mesa disponible en ${min} min (a las ${at})`,
      bookingBannerQuick:
        "Paso rápido — la mesa queda reservada 1 hora desde la hora indicada.",
      bookingBannerStandard:
        "Reservar para ahora — reserva clásica: la mesa queda reservada 2 horas desde la hora indicada.",
      optionalShort: "(opcional)",
      dishI18nHint:
        "Nombres EN / NL / ES: se muestran si el cliente elige ese idioma; déjelos en blanco para usar el nombre principal.",
      dishNameEnLabel: "Nombre (inglés)",
      dishNameNlLabel: "Nombre (neerlandés)",
      dishNameEsLabel: "Nombre (español)",
      adminLoginTitle: "Acceso restaurador",
      adminLoginHelp:
        "Inicie sesión para gestionar mesas y menú. Los clientes pueden ver el menú sin cuenta.",
      adminEmailLabel: "Correo",
      adminPasswordLabel: "Contraseña",
      adminBtnLogin: "Entrar",
      adminBtnCancel: "Cancelar",
      adminSetupHint:
        "Cuenta de prueba: vea devTestCredentials.ts (backend + frontend). O POST /api/admin/setup si la base está vacía.",
      checkinTitle: "Registro",
      checkinTableLine: (id: string | number) => `Mesa n.º ${id}`,
      checkinConfirm: "Confirmar reserva",
      checkinBack: "Volver",
      landingKicker: "Alta cocina",
      landingTitle: "Le espera una experiencia culinaria auténtica",
      landingDesc:
        "Reserve una mesa en segundos, descubra nuestro menú o consulte el plano de mesas.",
      brandTagline: "Restaurante",
      promptTableName: "Nombre de la mesa (ej. T1):",
      promptTableCapacity: "Capacidad (ej. 4):",
      promptTableShape: "Forma (r = redonda, c = cuadrada, rect = rectangular):",
      guestsAbbr: "pers.",
      reservationTableHeading: (n: string) => `Mesa ${n}`,
      cancel: "Cancelar",
      networkError: "Error de red.",
    },
  }[lang];

  const firstTableFreeText = (() => {
    if (!time || tables.length === 0) return "";
    if (tables.some((tb) => tb.status === "free")) return t.firstFreeNow;

    const busyUntilTimes = tables
      .map((x) => x.busyUntil)
      .filter((x): x is string => Boolean(x));
    if (busyUntilTimes.length === 0) return t.firstFreeNow;

    const earliest = busyUntilTimes.sort()[0]; // HH:MM
    const [sh, sm] = time.split(":").map(Number);
    const [eh, em] = earliest.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    const diff = Math.max(0, endMin - startMin);

    return t.firstFreeIn(diff, earliest);
  })();

  const setTodayAndNow = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    setDate(`${yyyy}-${mm}-${dd}`);
    setTime(`${hours}:${minutes}`);
  };

  // Chargement des tables pour le mode admin
  const loadAllTables = async () => {
    try {
      const res = await fetch(apiUrl("/api/tables"));
      if (!res.ok) return;
      const data: BaseTable[] = await res.json();
      setAllTables(data);
    } catch {
      // ignore pour l'instant
    }
  };

  const loadDishes = async () => {
    try {
      const res = await fetch(apiUrl("/api/dishes"));
      if (!res.ok) return;
      const data: Dish[] = await res.json();
      setDishes(data);
    } catch {
      // ignore
    }
  };

  const loadAdminDishes = async () => {
    try {
      const res = await fetch(apiUrl("/api/dishes"));
      if (!res.ok) return;
      const data: Dish[] = await res.json();
      setAdminDishes(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (adminMode) {
      loadAllTables();
      if (adminSection === "dishes") loadAdminDishes();
    }
  }, [adminMode, adminSection]);

  useEffect(() => {
    if (screen === "dishes") loadDishes();
  }, [screen]);

  useEffect(() => {
    if (!adminMode) loadDishes();
  }, [adminMode]);

  useEffect(() => {
    if (screen === "menu" || screen === "dishes") {
      setMessage("");
    }
    if (screen === "menu") {
      setBookingEntry(null);
    }
  }, [screen]);

  const loadAvailability = async () => {
    setMessage("");
    setSelectedTable(null);

    if (!date || !time || !guests) {
      setMessage(t.fillAllFields);
      return;
    }

    try {
      const res = await fetch(
        apiUrl(
          `/api/plan-status?date=${encodeURIComponent(
            date
          )}&time=${encodeURIComponent(time)}&guests=${guests}&durationMinutes=${reservationDurationMinutes}`
        )
      );
      if (!res.ok) {
        setMessage(t.loadError);
        return;
      }
      const data: AvailabilityResponse = await res.json();
      setTables(data);
      if (data.length === 0) {
        setMessage(t.noTables);
      }
    } catch {
      setMessage(t.loadNetworkError as string);
    }
  };

  const confirmReservation = async () => {
    if (!selectedTable || !name) {
      setMessage(t.chooseTableAndName);
      return;
    }
    if (selectedTable.status === "busy") {
      setMessage(t.tableBusy);
      return;
    }
    setMessage("");

    const res = await fetch(apiUrl("/api/reservations"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tableId: selectedTable.id,
        date,
        time,
        guestName: name,
        guestCount: guests,
        durationMinutes: reservationDurationMinutes,
      }),
    });

    if (!res.ok) {
      setMessage(t.reservationError);
      return;
    }

    setMessage(t.reservationOk);
    setSelectedTable(null);
    setName("");
    loadAvailability();
  };

  const handleAdminToggle = () => {
    setMessage("");
    setAdminMode(false);
    setAdminLoginOpen(false);
    setSelectedTable(null);
  };

  const startDrag = (
    e: React.MouseEvent<HTMLButtonElement>,
    table: BaseTable
  ) => {
    const rect = (e.currentTarget.parentElement as HTMLDivElement).getBoundingClientRect();
    const offsetX = e.clientX - rect.left - table.posX;
    const offsetY = e.clientY - rect.top - table.posY;
    setDraggingId(table.id);
    setDragOffset({ x: offsetX, y: offsetY });
  };

  const onPlanMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!adminMode || draggingId === null || !dragOffset) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - dragOffset.x;
    const y = e.clientY - rect.top - dragOffset.y;

    setAllTables((prev) =>
      prev.map((t) =>
        t.id === draggingId ? { ...t, posX: x, posY: y } : t
      )
    );
  };

  const onPlanMouseUp = async () => {
    if (!adminMode || draggingId === null) return;
    const moved = allTables.find((t) => t.id === draggingId);
    setDraggingId(null);
    setDragOffset(null);
    if (!moved) return;

    await adminFetch(`/api/tables/${moved.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        posX: Math.round(moved.posX),
        posY: Math.round(moved.posY),
      }),
    });
  };

  const addTable = async () => {
    const name = window.prompt(t.promptTableName as string);
    if (!name) return;
    const capacityStr = window.prompt(t.promptTableCapacity as string);
    const capacity = capacityStr ? Number(capacityStr) : NaN;
    if (!capacity || Number.isNaN(capacity)) {
      setMessage(t.invalidCapacity);
      return;
    }

    const shapeInput = window
      .prompt(t.promptTableShape as string, "r")
      ?.toLowerCase()
      .trim();

    let shape: string = "ROUND";
    if (
      shapeInput === "c" ||
      shapeInput === "carree" ||
      shapeInput === "carrée" ||
      shapeInput === "square" ||
      shapeInput === "vierkant" ||
      shapeInput === "cuadrado"
    ) {
      shape = "SQUARE";
    } else if (
      shapeInput === "rect" ||
      shapeInput === "rectangulaire" ||
      shapeInput === "rectangle" ||
      shapeInput === "rechthoek" ||
      shapeInput === "rectangular"
    ) {
      shape = "RECTANGLE";
    }

    const res = await adminFetch("/api/tables", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        capacity,
        posX: 50,
        posY: 50,
        shape,
      }),
    });
    if (!res.ok) {
      setMessage(t.createTableError);
      return;
    }
    setMessage("");
    loadAllTables();
  };

  const toggleAdminSelection = (id: number) => {
    setAdminSelection((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const deleteTable = async (id: number) => {
    try {
      const res = await adminFetch(`/api/tables/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(data.error || t.mergeError);
        return;
      }
    } catch {
      setMessage(t.networkError as string);
      return;
    }
    setAdminSelection((prev) => prev.filter((x) => x !== id));
    setMergeHistory((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      window.localStorage.setItem("mergeHistory", JSON.stringify(next));
      return next;
    });
    loadAllTables();
  };

  const onDishImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setDishImagePreview("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      setDishImagePreview(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const submitEditDish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingDishId === null) return;
    const name = dishName.trim();
    const price = parseFloat(dishPrice);
    if (!name || Number.isNaN(price) || price < 0) {
      setMessage(t.fillAllFields);
      return;
    }
    setMessage("");
    const body: {
      name: string;
      nameEn: string;
      nameNl: string;
      nameEs: string;
      price: number;
      imageBase64?: string;
      isQuick?: boolean;
    } = {
      name,
      nameEn: dishNameEn.trim(),
      nameNl: dishNameNl.trim(),
      nameEs: dishNameEs.trim(),
      price,
      isQuick: dishIsQuick,
    };
    if (dishImagePreview.startsWith("data:")) body.imageBase64 = dishImagePreview;

    try {
      const res = await adminFetch(`/api/dishes/${editingDishId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage((data as { error?: string }).error || t.createDishError);
        return;
      }
      setEditingDishId(null);
      setDishName("");
      setDishNameEn("");
      setDishNameNl("");
      setDishNameEs("");
      setDishPrice("");
      setDishImagePreview("");
      if (editFileInputRef.current) editFileInputRef.current.value = "";
      loadAdminDishes();
    } catch {
      setMessage(t.networkError as string);
    }
  };

  const startEditDish = (d: Dish) => {
    setEditingDishId(d.id);
    setDishName(d.name);
    setDishNameEn((d.nameEn ?? "").trim());
    setDishNameNl((d.nameNl ?? "").trim());
    setDishNameEs((d.nameEs ?? "").trim());
    setDishPrice(String(d.price));
    setDishImagePreview(d.imageUrl || "");
    setDishIsQuick(Boolean(d.isQuick));
  };

  const cancelEditDish = () => {
    setEditingDishId(null);
    setDishName("");
    setDishNameEn("");
    setDishNameNl("");
    setDishNameEs("");
    setDishPrice("");
    setDishImagePreview("");
    setDishIsQuick(false);
    if (editFileInputRef.current) editFileInputRef.current.value = "";
  };

  const deleteDish = async (id: number) => {
    await adminFetch(`/api/dishes/${id}`, { method: "DELETE" });
    setAdminDishes((prev) => prev.filter((x) => x.id !== id));
    if (editingDishId === id) cancelEditDish();
  };

  const mergeSelectedTables = async () => {
    if (adminSelection.length < 2) {
      setMessage(t.mergeNeedTwo);
      return;
    }
    const selected = allTables.filter((t) => adminSelection.includes(t.id));
    const totalCapacity = selected.reduce((sum, t) => sum + t.capacity, 0);
    const avgX =
      selected.reduce((sum, t) => sum + t.posX, 0) / selected.length || 50;
    const avgY =
      selected.reduce((sum, t) => sum + t.posY, 0) / selected.length || 50;

    const name =
      "M-" +
      selected
        .map((t) => t.name)
        .join("+")
        .slice(0, 20);

    let newId: number | null = null;
    try {
      const res = await adminFetch("/api/tables", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          capacity: totalCapacity,
          posX: Math.round(avgX),
          posY: Math.round(avgY),
          shape: "RECTANGLE",
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(data.error || t.mergeError);
        return;
      }
      const created = (await res.json().catch(() => null)) as BaseTable | null;
      newId = typeof created?.id === "number" ? created.id : null;

      // Désactiver les anciennes tables
      const delResults = await Promise.all(
        selected.map((t) =>
          adminFetch(`/api/tables/${t.id}`, {
            method: "DELETE",
          })
        )
      );
      const firstFailed = delResults.find((r) => !r.ok);
      if (firstFailed) {
        const data = (await firstFailed.json().catch(() => ({}))) as { error?: string };
        setMessage(data.error || t.mergeError);
        return;
      }
    } catch {
      setMessage(t.networkError as string);
      return;
    }

    if (typeof newId === "number") {
      setMergeHistory((prev) => {
        const next = { ...prev, [newId]: selected };
        window.localStorage.setItem("mergeHistory", JSON.stringify(next));
        return next;
      });
      setAdminSelection([newId]);
    } else {
      setAdminSelection([]);
    }
    setMessage("");
    loadAllTables();
  };

  const splitSelectedTable = async () => {
    if (adminSelection.length !== 1) return;
    const mergedId = adminSelection[0];
    const originals = mergeHistory[mergedId];
    if (!originals || originals.length < 2) return;

    setMessage("");
    // Recréer les tables originales
    await Promise.all(
      originals.map((ot) =>
        adminFetch("/api/tables", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: ot.name,
            capacity: ot.capacity,
            posX: Math.round(ot.posX),
            posY: Math.round(ot.posY),
            shape: ot.shape,
          }),
        })
      )
    );

    // Supprimer la table fusionnée
    await deleteTable(mergedId);

    // Nettoyer l'historique
    setMergeHistory((prev) => {
      const next = { ...prev };
      delete next[mergedId];
      window.localStorage.setItem("mergeHistory", JSON.stringify(next));
      return next;
    });

    setAdminSelection([]);
    loadAllTables();
  };

  // Rendu complet
  if (adminMode) {
    return (
      <div className="app">
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <button onClick={() => setLang("fr")}>FR</button>
          <button onClick={() => setLang("en")}>EN</button>
          <button onClick={() => setLang("nl")}>NL</button>
          <button onClick={() => setLang("es")}>ES</button>
        </div>
        <div className="admin-header">
          <div>
            <div className="admin-title">{t.adminTitle}</div>
            <div className="admin-subtitle">{t.adminSubtitle}</div>
          </div>
          <div className="admin-actions">
            <button
              type="button"
              className={"admin-nav-btn" + (adminSection === "tables" ? " is-active" : "")}
              onClick={() => setAdminSection("tables")}
            >
              {t.manageTables}
            </button>
            <button
              type="button"
              className={"admin-nav-btn" + (adminSection === "dishes" ? " is-active" : "")}
              onClick={() => setAdminSection("dishes")}
            >
              {t.manageDishes}
            </button>
            {adminSection === "tables" && (
              <button type="button" className="admin-toolbar-btn" onClick={addTable}>
                {t.addTable}
              </button>
            )}
            {adminSection === "dishes" && (
              <button
                type="button"
                className="admin-toolbar-btn"
                onClick={() =>
                  document.getElementById("admin-add-dish")?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  })
                }
              >
                {t.addDish}
              </button>
            )}
            <button type="button" className="admin-back-btn" onClick={handleAdminToggle}>
              {t.backToClient}
            </button>
          </div>
        </div>

        {adminSection === "tables" && (
          <div className="admin-layout">
            <aside className="admin-sidebar">
              <h3>{t.tablesLabel}</h3>
              <small>{t.tablesHelp}</small>
              <div className="admin-table-actions">
                <button className="btn" onClick={mergeSelectedTables}>
                  {t.mergeTables}
                </button>
                <button
                  className="btn ghost"
                  onClick={splitSelectedTable}
                  disabled={adminSelection.length !== 1 || !mergeHistory[adminSelection[0]]}
                  title={
                    adminSelection.length !== 1
                      ? "Sélectionnez une seule table fusionnée."
                      : !mergeHistory[adminSelection[0]]
                        ? "Cette table n'a pas d'historique de fusion."
                        : ""
                  }
                >
                  Séparer
                </button>
              </div>
              <div className="admin-table-list">
                {allTables.map((tbl) => (
                  <div
                    key={tbl.id}
                    className={
                      "admin-table-item" +
                      (adminSelection.includes(tbl.id) ? " admin-table-item-active" : "")
                    }
                    onClick={() => toggleAdminSelection(tbl.id)}
                  >
                    <div>
                      <strong>{tbl.name}</strong>
                      <span>
                        {" "}
                        · {tbl.capacity} {t.guestsAbbr as string} · {shapeDisplay(lang, tbl.shape)}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                      <span>
                        x: {Math.round(tbl.posX)}, y: {Math.round(tbl.posY)}
                      </span>
                      <button
                        type="button"
                        className="btn danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTable(tbl.id);
                        }}
                      >
                        {t.delete}
                      </button>
                    </div>
                  </div>
                ))}
                {allTables.length === 0 && (
                  <small>{t.noneYet}</small>
                )}
              </div>
            </aside>

            <div
              className="plan"
              onMouseMove={onPlanMouseMove}
              onMouseUp={onPlanMouseUp}
              onMouseLeave={onPlanMouseUp}
            >
              {allTables.map((table) => (
                <button
                  key={table.id}
                  className={
                    "table-button table-" + table.shape.toLowerCase()
                  }
                  style={{
                    left: table.posX,
                    top: table.posY,
                    cursor: "grab",
                  }}
                  onMouseDown={(e) => startDrag(e, table)}
                >
                  {table.name}
                  <span className="capacity">{table.capacity}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {adminSection === "dishes" && (
          <div className="admin-dishes-section">
            <h3>{t.dishesSectionTitle}</h3>
            <div className="add-dish-block" id="admin-add-dish">
              <h4>{t.addDish}</h4>
              <AddDishForm
                t={t}
                lang={lang}
                resetTrigger={addFormKey}
                onSuccess={() => {
                  loadAdminDishes();
                  setAddFormKey((k) => k + 1);
                  setMessage("");
                }}
                onError={setMessage}
              />
            </div>
            {editingDishId !== null && (
              <div className="edit-dish-block">
                <h4>{t.editDish}</h4>
                <form onSubmit={submitEditDish} className="dish-form">
                  <label>
                    {t.dishNameLabel}
                    <input
                      type="text"
                      value={dishName}
                      onChange={(e) => setDishName(e.target.value)}
                      required
                    />
                  </label>
                  <p
                    className="dish-i18n-hint"
                    style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", color: "var(--muted)" }}
                  >
                    {t.dishI18nHint as string}
                  </p>
                  <label>
                    {t.dishNameEnLabel as string}
                    <input type="text" value={dishNameEn} onChange={(e) => setDishNameEn(e.target.value)} />
                  </label>
                  <label>
                    {t.dishNameNlLabel as string}
                    <input type="text" value={dishNameNl} onChange={(e) => setDishNameNl(e.target.value)} />
                  </label>
                  <label>
                    {t.dishNameEsLabel as string}
                    <input type="text" value={dishNameEs} onChange={(e) => setDishNameEs(e.target.value)} />
                  </label>
                  <label>
                    {t.priceLabel}
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={dishPrice}
                      onChange={(e) => setDishPrice(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    {t.imageLabel}{" "}
                    <span className="optional">{t.optionalShort as string}</span>
                    <input
                      ref={editFileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={onDishImageChange}
                    />
                  </label>
                  <label style={{ minWidth: 220 }}>
                    {t.quickPrepLabel}
                    <input
                      type="checkbox"
                      checked={dishIsQuick}
                      onChange={(e) => setDishIsQuick(e.target.checked)}
                      style={{ width: 18, height: 18, marginTop: 10 }}
                    />
                  </label>
                  {(dishImagePreview || adminDishes.find((d) => d.id === editingDishId)?.imageUrl) && (
                    <div className="dish-image-preview">
                      <span>{t.imagePreview}</span>
                      <img
                        src={(() => {
                          const prev = dishImagePreview.trim();
                          if (prev.startsWith("data:")) return prev;
                          if (prev) return dishImageSrc(prev);
                          return dishImageSrc(
                            adminDishes.find((d) => d.id === editingDishId)?.imageUrl || ""
                          );
                        })()}
                        alt={dishDisplayName(
                          {
                            id: editingDishId ?? 0,
                            name: dishName,
                            nameEn: dishNameEn,
                            nameNl: dishNameNl,
                            nameEs: dishNameEs,
                            price: Number(dishPrice) || 0,
                            imageUrl: "",
                            isQuick: dishIsQuick,
                          },
                          lang
                        )}
                      />
                    </div>
                  )}
                  <div className="dish-form-actions">
                    <button type="submit" className="btn primary">
                      {t.saveDish}
                    </button>
                    <button type="button" className="btn ghost" onClick={cancelEditDish}>
                      {t.cancel as string}
                    </button>
                  </div>
                </form>
              </div>
            )}
            <div className="dish-list">
              {adminDishes.length === 0 && <p>{t.noDishesYet}</p>}
              {adminDishes.map((d) => (
                <div key={d.id} className="dish-card admin-dish-card">
                  {d.imageUrl && (
                    <img src={dishImageSrc(d.imageUrl)} alt={dishDisplayName(d, lang)} />
                  )}
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <strong>{dishDisplayName(d, lang)}</strong>
                      {d.isQuick && <span className="dish-badge">{t.quickPrepBadge}</span>}
                    </div>
                    <span> — {d.price} €</span>
                  </div>
                  <div className="admin-dish-actions">
                    <button type="button" className="btn" onClick={() => startEditDish(d)}>
                      {t.editDish}
                    </button>
                    <button type="button" className="btn danger" onClick={() => deleteDish(d.id)}>
                      {t.delete}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {message && <div className="message">{message}</div>}
      </div>
    );
  }

  return (
    <div className="app">
      {adminLoginOpen && !adminMode && !disableAuth && (
        <div
          className="admin-login-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-login-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setAdminLoginOpen(false);
              setMessage("");
            }
          }}
        >
          <div className="card admin-login-card" onClick={(e) => e.stopPropagation()}>
            <h2 id="admin-login-title">{t.adminLoginTitle as string}</h2>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 0 }}>
              {t.adminLoginHelp as string}
            </p>
            <form onSubmit={submitAdminLogin} className="dish-form" style={{ marginBottom: 0 }}>
              <label style={{ minWidth: "100%" }}>
                {t.adminEmailLabel as string}
                <input
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  autoFocus
                  required
                />
              </label>
              {!emailOnlyLogin && (
                <label style={{ minWidth: "100%" }}>
                  {t.adminPasswordLabel as string}
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    required
                  />
                </label>
              )}
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button type="submit">{t.adminBtnLogin as string}</button>
                <button
                  type="button"
                  onClick={() => {
                    setAdminLoginOpen(false);
                    setMessage("");
                  }}
                >
                  {t.adminBtnCancel as string}
                </button>
              </div>
            </form>
            {message && <div className="message">{message}</div>}
            <small style={{ color: "#94a3b8" }}>{t.adminSetupHint as string}</small>
          </div>
        </div>
      )}

      <div className="topbar">
        <div className="brand">
          <strong>{t.kioskTitle}</strong>
          <small>{t.brandTagline as string}</small>
        </div>
        <div className="lang-switch">
          <button className={lang === "fr" ? "active" : ""} onClick={() => setLang("fr")}>FR</button>
          <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button>
          <button className={lang === "nl" ? "active" : ""} onClick={() => setLang("nl")}>NL</button>
          <button className={lang === "es" ? "active" : ""} onClick={() => setLang("es")}>ES</button>
        </div>
      </div>

      {/* Check-in supprimé */}

      {screen === "menu" && (
        <div className="landing">
          <section className="landing-left">
            <div className="landing-kicker">{t.landingKicker as string}</div>
            <h2 className="landing-title font-serif">{t.landingTitle as string}</h2>
            <p className="landing-desc">{t.landingDesc as string}</p>
            <div className="cta-row">
              <button
                className="btn primary"
                onClick={() => {
                  setTodayAndNow();
                  setGuests(2);
                  setReservationDurationMinutes(120);
                  setBookingEntry("standard");
                  setScreen("now");
                }}
              >
                {t.bookNow}
              </button>
              <button
                className="btn"
                onClick={() => {
                  setTodayAndNow();
                  setGuests(1);
                  setReservationDurationMinutes(60);
                  setBookingEntry("quick");
                  setScreen("now");
                }}
              >
                {t.quickPass}
              </button>
              <button className="btn" onClick={() => setScreen("dishes")}>
                {t.viewMenu}
              </button>
            </div>
            <div style={{ marginTop: "1.25rem" }}>
              <button
                className="btn"
                onClick={() => {
                  setMessage("");
                  if (disableAuth) {
                    setAdminMode(true);
                    setAdminLoginOpen(false);
                  } else {
                    setAdminLoginOpen(true);
                  }
                  setSelectedTable(null);
                }}
              >
                {t.adminModeButton}
              </button>
            </div>
          </section>
        </div>
      )}

      {screen === "dishes" && (
        <div className="client-menu-section">
          <h2>{t.menuTitle}</h2>
          <div className="dish-grid">
            {dishes.length === 0 && <p>{t.noDishesYet}</p>}
            {dishes.map((d) => (
              <div key={d.id} className="dish-card">
                {d.imageUrl ? (
                  <img src={dishImageSrc(d.imageUrl)} alt={dishDisplayName(d, lang)} />
                ) : (
                  <div className="dish-card-no-image" />
                )}
                <div className="dish-card-body">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                    <strong>{dishDisplayName(d, lang)}</strong>
                    {d.isQuick && <span className="dish-badge">{t.quickPrepBadge}</span>}
                  </div>
                  <span>{d.price} €</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "1.25rem", display: "flex", justifyContent: "center" }}>
            <button
              className="btn ghost"
              onClick={() => {
                setBookingEntry(null);
                setScreen("menu");
              }}
            >
              {t.backToMenu}
            </button>
          </div>
        </div>
      )}

      {screen === "now" && bookingEntry && (
        <div className="booking-context-banner" role="status">
          {bookingEntry === "quick"
            ? (t.bookingBannerQuick as string)
            : (t.bookingBannerStandard as string)}
        </div>
      )}

      {screen !== "menu" && screen !== "dishes" && (
        <div className="form">
          {tables.length > 0 && (
            <div style={{ width: "100%", textAlign: "center", fontWeight: 600, color: "#14532d" }}>
              {firstTableFreeText}
            </div>
          )}
          <label>
            {t.date}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            {t.time}
            <select value={time} onChange={(e) => setTime(e.target.value)}>
              <option value="">--</option>
              {timeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.guests}
            <input
              type="number"
              min={1}
              value={guests}
              onChange={(e) => setGuests(Number(e.target.value))}
            />
          </label>
          <button onClick={loadAvailability}>
            {t.seeAvailability}
          </button>
          <button
            onClick={() => {
              setSelectedTable(null);
              setTables([]);
              setBookingEntry(null);
              setScreen("menu");
            }}
          >
            {t.backToMenu}
          </button>
        </div>
      )}

      {screen !== "menu" && screen !== "dishes" && (
        <div className="plan">
          {tables.map((table) => (
            <button
              key={table.id}
              className={
                "table-button table-" +
                table.shape.toLowerCase() +
                " " +
                (table.status === "busy" ? "table-busy" : "table-free") +
                (selectedTable?.id === table.id ? " table-button-selected" : "")
              }
              style={{
                left: table.posX,
                top: table.posY,
              }}
              onClick={() => setSelectedTable(table)}
            >
              {table.name}
              <span className="capacity">{table.capacity}</span>
            </button>
          ))}
        </div>
      )}

      {selectedTable && (
        <div className="reservation-panel">
          <h2>{(t.reservationTableHeading as (n: string) => string)(selectedTable.name)}</h2>
          <p>{t.tableCapacity(selectedTable.capacity)}</p>
          {selectedTable.status === "busy" && selectedTable.busyUntil && (
            <p>{t.busyUntil(selectedTable.busyUntil)}</p>
          )}
          {selectedTable.status === "free" && (
            <>
              <label>
                {t.yourName}
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button onClick={confirmReservation}>
                {t.confirmReservation}
              </button>
            </>
          )}
        </div>
      )}

      {message && <div className="message">{message}</div>}
    </div>
  );
};

