// Testovací data: realistický týden týmu (stálý rozvrh z července 2026).
// Dřív to byla konstanta PRESET pro tlačítko „Předvyplnit rozvrh" — tlačítko bylo
// odstraněno (skutečný stálý rozvrh žije v databázi a upravuje se v appce).
export const TEAM_WEEK = {
  "Slavíček": { Po: "08:00", "Út": "08:00", St: "08:00", "Čt": "08:00", "Pá": "08:00" },
  "Víťa":     { Po: "09:00", "Út": "08:00", St: "09:00", "Čt": "09:00", "Pá": "08:00" },
  "Stibor":   { Po: "08:00", Po_ho: true, "Út": "08:00", St: "10:00", "Čt": "10:00", "Čt_ho": true, "Pá": "08:00" },
  "Lochman":  { Po: "08:00", "Út": "10:00", "Út_ho": true, St: "08:00", "Čt": "08:00", "Pá": "09:00", "Pá_ho": true },
  "Frťala":   { Po: "09:00", "Út": "10:00", St: "08:00", St_ho: true, "Čt": "08:00", "Čt_ho": true, "Pá": "10:00" },
  "Švarc":    { "Út": "09:00", St: "10:00", St_ho: true, "Čt": "10:00", "Pá": "09:00" }, // Vláďa — pondělí volno (bez klíče Po)
  "Andy":     { Po: "10:00", "Út": "09:00", "Út_ho": true, St: "09:00", "Čt": "09:00", "Pá": "10:00", "Pá_ho": true },
};
