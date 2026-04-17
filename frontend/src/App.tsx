import React, { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";

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
type Screen = "menu" | "now" | "later" | "dishes" | "checkin";
type Lang = "fr" | "en" | "nl" | "es";

type Dish = {
  id: number;
  name: string;
  price: number;
  imageUrl: string;
  isQuick?: boolean;
};

type AddDishFormProps = {
  t: Record<string, unknown>;
  resetTrigger: number;
  onSuccess: () => void;
  onError: (message: string) => void;
};

const AddDishForm: React.FC<AddDishFormProps> = ({ t, resetTrigger, onSuccess, onError }) => {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [isQuick, setIsQuick] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setName("");
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
      onError((t.fillAllFields as string) || "Remplissez les champs.");
      return;
    }
    const body: { name: string; price: number; imageBase64?: string; isQuick?: boolean } = {
      name: n,
      price: p,
      isQuick,
    };
    if (imagePreview.startsWith("data:")) body.imageBase64 = imagePreview;

    try {
      const token = typeof window !== "undefined" ? window.localStorage.getItem("adminToken") || "" : "";
      const headers = new Headers({ "Content-Type": "application/json" });
      if (token) headers.set("authorization", `Bearer ${token}`);
      const res = await fetch("/api/dishes", {
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
      onError("Erreur réseau.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="dish-form add-dish-form">
      <label>
        {t.dishNameLabel as string}
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
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
        {t.imageLabel as string} <span className="optional">(optionnel)</span>
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
      <button type="submit">{t.addDish as string}</button>
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
  const [adminEmail, setAdminEmail] = useState<string>("");
  const [adminPassword, setAdminPassword] = useState<string>("");
  const [adminToken, setAdminToken] = useState<string>(
    typeof window !== "undefined" ? window.localStorage.getItem("adminToken") || "" : ""
  );
  const [allTables, setAllTables] = useState<BaseTable[]>([]);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(
    null
  );
  const [screen, setScreen] = useState<Screen>("menu");
  const [adminSelection, setAdminSelection] = useState<number[]>([]);
  const [lang, setLang] = useState<Lang>("fr");
  const [reservationDurationMinutes, setReservationDurationMinutes] = useState<number>(120);
  const [checkinTableId, setCheckinTableId] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkin") === "1") {
      const tid = Number(params.get("tableId"));
      if (tid) {
        setCheckinTableId(tid);
        setScreen("checkin");
      }
    }
  }, []);

  const publicBaseUrl =
    (typeof window !== "undefined" && (import.meta as any).env?.VITE_PUBLIC_BASE_URL) ||
    "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const qrBase = String(publicBaseUrl || origin).replace(/\/+$/, "");
  const tableQrValue = (tableId: number) => `${qrBase}/?checkin=1&tableId=${tableId}`;

  const doCheckin = async () => {
    if (!checkinTableId) return;
    setMessage("");
    try {
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: checkinTableId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage((data as { error?: string }).error || "Impossible de confirmer.");
        return;
      }
      setMessage("Réservation confirmée.");
    } catch {
      setMessage("Erreur réseau.");
    }
  };
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [adminDishes, setAdminDishes] = useState<Dish[]>([]);
  const [adminSection, setAdminSection] = useState<"tables" | "dishes">("tables");
  const [dishName, setDishName] = useState("");
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
    return fetch(input, { ...init, headers });
  };

  const submitAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage((data as { error?: string }).error || "Identifiants invalides.");
        return;
      }
      const token = (data as { token?: string }).token || "";
      if (!token) {
        setMessage("Réponse serveur invalide.");
        return;
      }
      setAdminToken(token);
      window.localStorage.setItem("adminToken", token);
      setAdminLoginOpen(false);
      setAdminMode(true);
    } catch {
      setMessage("Erreur réseau. Le serveur est-il démarré ?");
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
      manageTables: "Tables",
      quickPass: "Passage rapide",
      quickPrepLabel: "Préparation rapide",
      quickPrepBadge: "Rapide",
      firstFreeNow: "Première table disponible : maintenant",
      firstFreeIn: (min: number, at: string) =>
        `Première table disponible dans ${min} min (à ${at})`,
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
      const res = await fetch("/api/tables");
      if (!res.ok) return;
      const data: BaseTable[] = await res.json();
      setAllTables(data);
    } catch {
      // ignore pour l'instant
    }
  };

  const loadDishes = async () => {
    try {
      const res = await fetch("/api/dishes");
      if (!res.ok) return;
      const data: Dish[] = await res.json();
      setDishes(data);
    } catch {
      // ignore
    }
  };

  const loadAdminDishes = async () => {
    try {
      const res = await fetch("/api/dishes");
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

  if (adminLoginOpen && !adminMode) {
    return (
      <div className="app">
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <h1>{t.kioskTitle}</h1>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={() => setLang("fr")}>FR</button>
            <button onClick={() => setLang("en")}>EN</button>
            <button onClick={() => setLang("nl")}>NL</button>
            <button onClick={() => setLang("es")}>ES</button>
          </div>
        </div>

        <div className="card" style={{ maxWidth: 420 }}>
          <h2>Accès restaurateur</h2>
          <form onSubmit={submitAdminLogin} className="dish-form" style={{ marginBottom: 0 }}>
            <label style={{ minWidth: "100%" }}>
              Email
              <input
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                autoFocus
                required
              />
            </label>
            <label style={{ minWidth: "100%" }}>
              Mot de passe
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                required
              />
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="submit">Se connecter</button>
              <button
                type="button"
                onClick={() => {
                  setAdminLoginOpen(false);
                  setMessage("");
                }}
              >
                Annuler
              </button>
            </div>
          </form>
          {message && <div className="message">{message}</div>}
          <small style={{ color: "#94a3b8" }}>
            Si c’est la 1ère fois, il faut créer le compte via l’endpoint setup (je te donne la commande juste après).
          </small>
        </div>
      </div>
    );
  }

  const loadAvailability = async () => {
    setMessage("");
    setSelectedTable(null);

    if (!date || !time || !guests) {
      setMessage(t.fillAllFields);
      return;
    }

    const res = await fetch(
      `/api/plan-status?date=${encodeURIComponent(
        date
      )}&time=${encodeURIComponent(time)}&guests=${guests}&durationMinutes=${reservationDurationMinutes}`
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

    const res = await fetch("/api/reservations", {
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
    const name = window.prompt("Nom de la table (ex: T1) :");
    if (!name) return;
    const capacityStr = window.prompt("Capacité (ex: 4) :");
    const capacity = capacityStr ? Number(capacityStr) : NaN;
    if (!capacity || Number.isNaN(capacity)) {
      setMessage(t.invalidCapacity);
      return;
    }

    const shapeInput = window
      .prompt(
        "Forme de la table (r = ronde, c = carrée, rect = rectangulaire) :",
        "r"
      )
      ?.toLowerCase()
      .trim();

    let shape: string = "ROUND";
    if (shapeInput === "c" || shapeInput === "carree" || shapeInput === "carrée") {
      shape = "SQUARE";
    } else if (shapeInput === "rect" || shapeInput === "rectangulaire") {
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
    await adminFetch(`/api/tables/${id}`, {
      method: "DELETE",
    });
    setAdminSelection((prev) => prev.filter((x) => x !== id));
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
    const body: { name: string; price: number; imageBase64?: string; isQuick?: boolean } = {
      name,
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
      setDishPrice("");
      setDishImagePreview("");
      if (editFileInputRef.current) editFileInputRef.current.value = "";
      loadAdminDishes();
    } catch {
      setMessage("Erreur réseau.");
    }
  };

  const startEditDish = (d: Dish) => {
    setEditingDishId(d.id);
    setDishName(d.name);
    setDishPrice(String(d.price));
    setDishImagePreview(d.imageUrl || "");
    setDishIsQuick(Boolean(d.isQuick));
  };

  const cancelEditDish = () => {
    setEditingDishId(null);
    setDishName("");
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
      setMessage(t.mergeError);
      return;
    }

    // Désactiver les anciennes tables
    await Promise.all(
      selected.map((t) =>
        adminFetch(`/api/tables/${t.id}`, {
          method: "DELETE",
        })
      )
    );

    setAdminSelection([]);
    setMessage("");
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
              onClick={() => setAdminSection("tables")}
              style={{
                background: adminSection === "tables" ? "#22c55e" : "transparent",
                border: "1px solid #4b5563",
              }}
            >
              {t.manageTables}
            </button>
            <button
              onClick={() => setAdminSection("dishes")}
              style={{
                background: adminSection === "dishes" ? "#22c55e" : "transparent",
                border: "1px solid #4b5563",
              }}
            >
              {t.manageDishes}
            </button>
            {adminSection === "tables" && (
              <button onClick={addTable}>{t.addTable}</button>
            )}
            <button onClick={handleAdminToggle}>{t.backToClient}</button>
          </div>
        </div>

        {adminSection === "tables" && (
          <div className="admin-layout">
            <aside className="admin-sidebar">
              <h3>{t.tablesLabel}</h3>
              <small>{t.tablesHelp}</small>
              <button onClick={mergeSelectedTables}>{t.mergeTables}</button>
              <div className="admin-table-list">
                {allTables.map((t) => (
                  <div
                    key={t.id}
                    className={
                      "admin-table-item" +
                      (adminSelection.includes(t.id) ? " admin-table-item-active" : "")
                    }
                    onClick={() => toggleAdminSelection(t.id)}
                  >
                    <div>
                      <strong>{t.name}</strong>
                      <span> · {t.capacity} pers. · {t.shape}</span>
                      <div style={{ marginTop: 8 }}>
                        <QRCodeCanvas value={tableQrValue(t.id)} size={72} includeMargin />
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                      <span>
                        x: {Math.round(t.posX)}, y: {Math.round(t.posY)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTable(t.id);
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
            <div className="add-dish-block">
              <h4>{t.addDish}</h4>
              <AddDishForm
                t={t}
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
                    {t.imageLabel} <span className="optional">(optionnel)</span>
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
                        src={dishImagePreview || adminDishes.find((d) => d.id === editingDishId)?.imageUrl || ""}
                        alt=""
                      />
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button type="submit">{t.saveDish}</button>
                    <button type="button" onClick={cancelEditDish}>
                      Annuler
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
                    <img src={d.imageUrl} alt={d.name} />
                  )}
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <strong>{d.name}</strong>
                      {d.isQuick && <span className="dish-badge">{t.quickPrepBadge}</span>}
                    </div>
                    <span> — {d.price} €</span>
                  </div>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button type="button" onClick={() => startEditDish(d)}>
                      {t.editDish}
                    </button>
                    <button type="button" onClick={() => deleteDish(d.id)}>
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
      <div className="topbar">
        <div className="brand">
          <strong>{t.kioskTitle}</strong>
          <small>Restaurant</small>
        </div>
        <div className="lang-switch">
          <button className={lang === "fr" ? "active" : ""} onClick={() => setLang("fr")}>FR</button>
          <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button>
          <button className={lang === "nl" ? "active" : ""} onClick={() => setLang("nl")}>NL</button>
          <button className={lang === "es" ? "active" : ""} onClick={() => setLang("es")}>ES</button>
        </div>
      </div>

      {screen === "checkin" && (
        <div className="card" style={{ maxWidth: 520, margin: "0 auto" }}>
          <h2 className="font-serif" style={{ marginTop: 0 }}>Check‑in</h2>
          <p style={{ color: "var(--muted)" }}>
            Table #{checkinTableId || "?"}
          </p>
          <button className="btn primary" onClick={doCheckin}>
            Confirmer la réservation
          </button>
          {message && <div className="message">{message}</div>}
          <div style={{ marginTop: "1rem" }}>
            <button className="btn" onClick={() => setScreen("menu")}>Retour</button>
          </div>
        </div>
      )}

      {screen === "menu" && (
        <div className="landing">
          <section className="landing-left">
            <div className="landing-kicker">Fine dining</div>
            <h2 className="landing-title font-serif">
              Une expérience culinaire authentique vous attend
            </h2>
            <p className="landing-desc">
              Réservez une table en quelques secondes, découvrez notre menu, ou consultez le plan des tables.
            </p>
            <div className="cta-row">
              <button
                className="btn primary"
                onClick={() => {
                  setTodayAndNow();
                  setReservationDurationMinutes(120);
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
                  setAdminLoginOpen(true);
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
                  <img src={d.imageUrl} alt={d.name} />
                ) : (
                  <div className="dish-card-no-image" />
                )}
                <div className="dish-card-body">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                    <strong>{d.name}</strong>
                    {d.isQuick && <span className="dish-badge">{t.quickPrepBadge}</span>}
                  </div>
                  <span>{d.price} €</span>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => setScreen("menu")}
            style={{ marginTop: "1rem" }}
          >
            {t.backToMenu}
          </button>
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
          <h2>Table {selectedTable.name}</h2>
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

