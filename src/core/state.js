export function clamp(n, min, max){
  return Math.max(min, Math.min(max, n));
}

export function deepClone(obj){
  return JSON.parse(JSON.stringify(obj));
}

export function createInitialState(){
  return {
    meta: { version: "0.1.0", firstRun: true, seed: null },

    screen: "intro", // intro|character|job|main|event|action|papers|requirements|end
    schoolId: null,

    // time & phase
    time: { year: 1, term: 0, phase: "event" }, // phase: event|action

    // skills
    rollTotal: 0,
    skillPoints: 0,
    skills: { talent: 1, diligence: 1, social: 1, luck: 1 },

    // stats
    stats: { mood: 100, energy: 100, time: 100, inspiration: 100 },

    // outcomes
    results: {
      qualifiedPapers: 0, // ≥C刊：cssci/first/top
      topPapers: 0,
      national: 0,
      provincial: 0,
      leader: 0
    },

    // per-year / per-turn trackers
    teachingThisYear: 0,
    randomQuota: 0,

    // Step B: fixed panel (event stage) tracking
    fixedDone: false,          // whether fixed panel has been handled this turn
    fixedChoices: {},          // optional: store chosen counts/buttons for UI/debug

    // pending project applications
    pending: {
      national: null,     // { yearApplied }
      provincial: null,   // { yearApplied }
      nationalResolvedYear: null,
      provincialResolvedYear: null
    },

    // papers list
    papers: [], // {id, level, published, attemptsThisTurn, draftClicks}
    selectedPaperId: null,

    // requirements (visible)
    req: {
      maxYear: 6,
      teachPerYear: 2,
      paperNeed: 6,
      projectMode: "either", // either|national
      projectNeed: 1,         // number of projects required (used by reform doubling)
      topExtra: 0             // when >0 => top required (>=1)
    },

    // hidden system (do not display)
    hidden: {
      // mutually exclusive tightening events
      lock: null,                // "TOP" | "NATIONAL" | null
      topTightenCount: 0,        // max 3
      nationalTightenDone: false, // max 1

      // year-5 reform (quasi-tenure) mechanic
      reformTriggered: false,
      originalReq: null
    },

    // logs
    log: []
  };
}