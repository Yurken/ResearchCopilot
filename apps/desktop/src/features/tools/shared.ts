import type { ArxivRankingMode, ArxivSearchRequest, WebSearchOutcome } from "@research-copilot/types";

export const ARXIV_CATEGORIES: Array<{ domain: string; items: Array<{ id: string; zh: string }> }> = [
  {
    domain: "CS · 人工智能 & 机器学习",
    items: [
      { id: "cs.AI", zh: "人工智能" },
      { id: "cs.LG", zh: "机器学习" },
      { id: "cs.CL", zh: "计算语言学" },
      { id: "cs.CV", zh: "计算机视觉" },
      { id: "cs.NE", zh: "神经与进化计算" },
      { id: "cs.IR", zh: "信息检索" },
      { id: "cs.MA", zh: "多智能体系统" },
    ],
  },
  {
    domain: "CS · 系统 & 工程",
    items: [
      { id: "cs.RO", zh: "机器人学" },
      { id: "cs.SE", zh: "软件工程" },
      { id: "cs.DB", zh: "数据库" },
      { id: "cs.DC", zh: "分布式与并行计算" },
      { id: "cs.CR", zh: "密码学与安全" },
      { id: "cs.NI", zh: "网络与互联网" },
      { id: "cs.HC", zh: "人机交互" },
      { id: "cs.SY", zh: "系统与控制" },
      { id: "cs.PL", zh: "程序设计语言" },
      { id: "cs.DS", zh: "数据结构与算法" },
    ],
  },
  {
    domain: "Stat & Math",
    items: [
      { id: "stat.ML", zh: "统计机器学习" },
      { id: "stat.AP", zh: "统计应用" },
      { id: "stat.ME", zh: "统计方法论" },
      { id: "math.OC", zh: "优化与控制" },
      { id: "math.NA", zh: "数值分析" },
      { id: "math.PR", zh: "概率论" },
    ],
  },
  {
    domain: "EESS & 其他",
    items: [
      { id: "eess.IV", zh: "图像与视频处理" },
      { id: "eess.SP", zh: "信号处理" },
      { id: "eess.AS", zh: "音频与语音处理" },
      { id: "eess.SY", zh: "电气系统与控制" },
      { id: "q-bio.NC", zh: "神经元与认知" },
      { id: "physics.comp-ph", zh: "计算物理" },
    ],
  },
];

export const ARXIV_MODE_OPTIONS: Array<{ value: ArxivRankingMode; label: string; description: string }> = [
  {
    value: "relevance",
    label: "最相关",
    description: "优先找和关键词最贴合、最适合当前阅读的论文。",
  },
  {
    value: "quality",
    label: "质量预测",
    description: "优先找摘要信息密度、实验信号和潜在影响更强的论文。",
  },
];

export interface DomainVenues {
  label: string;
  arxivCats: string[];
  wosCats: string[];
  conf: { ccf_a: string[]; ccf_b: string[]; ccf_c: string[] };
  jour: { ccf_a: string[]; ccf_b: string[]; ccf_c: string[]; cas_1: string[]; cas_2: string[] };
}

export const DOMAIN_VENUES: Record<string, DomainVenues> = {
  ai: {
    label: "AI & 机器学习", arxivCats: ["cs.AI","cs.LG","cs.NE","stat.ML"],
    wosCats: ["Computer Science, Artificial Intelligence","Computer Science, Interdisciplinary Applications"],
    conf: { ccf_a: ["AAAI","NeurIPS","ICML","ICLR","IJCAI"], ccf_b: ["COLT","ECAI","AAMAS","UAI","KR","ICCBR","ICAPS","PPSN"], ccf_c: ["ACML","ICONIP","IJCNN","GECCO"] },
    jour: { ccf_a: ["AI","JMLR","TPAMI","TNNLS"], ccf_b: ["IJAR","JAIR"], ccf_c: ["Constraints","APIN"], cas_1: ["Nature Machine Intelligence","Artificial Intelligence","JMLR","TPAMI","TNNLS","IEEE Transactions on Neural Networks and Learning Systems"], cas_2: ["Pattern Recognition","Neural Networks","Knowledge-Based Systems","Neurocomputing"] },
  },
  cv: {
    label: "计算机视觉", arxivCats: ["cs.CV","eess.IV"],
    wosCats: ["Computer Science, Artificial Intelligence","Imaging Science & Photographic Technology"],
    conf: { ccf_a: ["CVPR","ICCV","ACM MM"], ccf_b: ["ECCV","ICMR","ICME","ISMAR","PG"], ccf_c: ["BMVC","ICIP","FG","WACV"] },
    jour: { ccf_a: ["TIP","TPAMI","IJCV","TVCG","TOG"], ccf_b: ["CVIU","SIIMS","CVMJ","TAP","TMM","TCSVT"], ccf_c: ["IET Image Processing"], cas_1: ["International Journal of Computer Vision","IEEE Transactions on Image Processing","TPAMI","Medical Image Analysis"], cas_2: ["Computer Vision and Image Understanding","Image and Vision Computing"] },
  },
  nlp: {
    label: "自然语言处理", arxivCats: ["cs.CL"],
    wosCats: ["Computer Science, Artificial Intelligence","Linguistics"],
    conf: { ccf_a: ["ACL"], ccf_b: ["EMNLP","NAACL","COLING"], ccf_c: ["EACL","CoNLL","SemEval"] },
    jour: { ccf_a: [], ccf_b: ["TACL"], ccf_c: ["Natural Language Engineering","Computational Linguistics"], cas_1: ["Transactions of the ACL","Computational Linguistics"], cas_2: ["Natural Language Processing Journal","Language Resources and Evaluation"] },
  },
  db: {
    label: "数据库 & 数据挖掘", arxivCats: ["cs.DB","cs.IR"],
    wosCats: ["Computer Science, Information Systems","Computer Science, Interdisciplinary Applications"],
    conf: { ccf_a: ["SIGMOD","SIGKDD","ICDE","SIGIR","VLDB"], ccf_b: ["CIKM","WSDM","PODS","DASFAA","EDBT","CIDR","SDM","ISWC","ICDM","ICDT","RecSys","WISE","ECML-PKDD"], ccf_c: ["APWeb","DEXA","SSDBM","ER"] },
    jour: { ccf_a: ["TODS","TOIS","TKDE","VLDBJ"], ccf_b: ["TKDD","TWEB","DKE","DMKD","IPM","IS","JASIST","JWS","KAIS","AEI"], ccf_c: ["Information Systems","Data & Knowledge Engineering"], cas_1: ["VLDB Journal","IEEE Transactions on Knowledge and Data Engineering","ACM Transactions on Database Systems"], cas_2: ["Data Mining and Knowledge Discovery","Information Processing & Management","Knowledge-Based Systems"] },
  },
  sys: {
    label: "系统 & 体系结构", arxivCats: ["cs.DC","cs.AR"],
    wosCats: ["Computer Science, Hardware & Architecture","Computer Science, Theory & Methods"],
    conf: { ccf_a: ["ASPLOS","ISCA","MICRO","HPCA","PPoPP","FAST","SC","USENIX ATC","EuroSys","OSDI","SOSP","HPDC"], ccf_b: ["SoCC","SPAA","PODC","IPDPS","ICDCS","CLUSTER","ICS","VEE","HiPEAC","PACT","ICPP","Euro-Par","MSST"], ccf_c: ["Middleware","NPC","ICDCN"] },
    jour: { ccf_a: ["TOCS","TOS","TC","TPDS","TACO"], ccf_b: ["TAAS","JPDC","JSA","TCC","TECS","TRETS","TVLSI"], ccf_c: ["Parallel Computing","Journal of Systems Architecture"], cas_1: ["IEEE Transactions on Parallel and Distributed Systems","ACM Transactions on Computer Systems"], cas_2: ["Cluster Computing","Journal of Parallel and Distributed Computing"] },
  },
  se: {
    label: "软件工程", arxivCats: ["cs.SE","cs.PL"],
    wosCats: ["Computer Science, Software Engineering","Computer Science, Theory & Methods"],
    conf: { ccf_a: ["ICSE","FSE","ASE","ISSTA","OOPSLA","PLDI","POPL"], ccf_b: ["ICPC","RE","ICFP","LCTES","MoDELS","SANER","ICSME","VMCAI","CC","ESEM","ISSRE","SAS","CAiSE","ECOOP"], ccf_c: ["PEPM","FASE","SCAM"] },
    jour: { ccf_a: ["TOSEM","TSE"], ccf_b: ["ASE","ESE","IST","JFP","JSS","SCP","SoSyM","STVR","SPE"], ccf_c: ["Software Quality Journal"], cas_1: ["IEEE Transactions on Software Engineering","ACM Transactions on Software Engineering and Methodology"], cas_2: ["Journal of Systems and Software","Information and Software Technology"] },
  },
  net: {
    label: "网络 & 通信", arxivCats: ["cs.NI"],
    wosCats: ["Telecommunications","Computer Science, Information Systems"],
    conf: { ccf_a: ["SIGCOMM","MobiCom","INFOCOM","NSDI"], ccf_b: ["CoNEXT","SECON","IPSN","MobiSys","ICNP","MobiHoc","NOSSDAV","IWQoS","IMC","SenSys"], ccf_c: ["WCNC","Globecom","ICC"] },
    jour: { ccf_a: ["JSAC","TMC","TON"], ccf_b: ["CN","TCOM","TWC","TOIT","TOMM","TOSN"], ccf_c: ["Wireless Networks","Ad Hoc Networks"], cas_1: ["IEEE/ACM Transactions on Networking","IEEE Transactions on Mobile Computing","IEEE Communications Surveys & Tutorials"], cas_2: ["Computer Networks","IEEE Transactions on Wireless Communications"] },
  },
  sec: {
    label: "安全 & 密码学", arxivCats: ["cs.CR"],
    wosCats: ["Computer Science, Information Systems","Computer Science, Theory & Methods"],
    conf: { ccf_a: ["CCS","EUROCRYPT","S&P","CRYPTO","USENIX Security","NDSS"], ccf_b: ["ACSAC","ASIACRYPT","ESORICS","CSFW","SRDS","CHES","DSN","RAID","PKC","TCC"], ccf_c: ["FC","ACNS","ISC","DIMVA"] },
    jour: { ccf_a: ["TDSC","TIFS"], ccf_b: ["TOPS","JCS"], ccf_c: ["Computers & Security","Journal of Cryptology"], cas_1: ["IEEE Transactions on Information Forensics and Security","IEEE Transactions on Dependable and Secure Computing"], cas_2: ["Computers & Security","Journal of Network and Computer Applications"] },
  },
  theory: {
    label: "理论计算机", arxivCats: ["cs.DS","cs.CC","cs.LO"],
    wosCats: ["Computer Science, Theory & Methods","Mathematics, Applied","Mathematics"],
    conf: { ccf_a: ["STOC","SODA","FOCS","LICS","CAV"], ccf_b: ["SoCG","ESA","CCC","ICALP","CADE","CONCUR","HSCC","SAT","FMCAD"], ccf_c: ["MFCS","ICTAC","FoSSaCS"] },
    jour: { ccf_a: ["TALG","TOCL","TOMS","Algorithmica","FMSD","JCSS","JSC","MSCS","TCS","IANDC","SICOMP"], ccf_b: [], ccf_c: [], cas_1: ["SIAM Journal on Computing","Journal of the ACM"], cas_2: ["Theoretical Computer Science","Journal of Computer and System Sciences"] },
  },
  hci: {
    label: "人机交互", arxivCats: ["cs.HC"],
    wosCats: ["Computer Science, Cybernetics","Computer Science, Information Systems"],
    conf: { ccf_a: ["CHI","UbiComp","UIST","CSCW"], ccf_b: ["GROUP","IUI","ISS","ECSCW","PERCOM","MobileHCI"], ccf_c: ["DIS","ASSETS","INTERACT"] },
    jour: { ccf_a: ["TOCHI","IJHCS"], ccf_b: ["HCI","IJHCI","UMUAI","CSCW"], ccf_c: ["Interacting with Computers","Personal and Ubiquitous Computing"], cas_1: ["ACM Transactions on Computer-Human Interaction","International Journal of Human-Computer Studies"], cas_2: ["Behaviour & Information Technology","Human-Computer Interaction"] },
  },
  cross: {
    label: "跨学科 & 多媒体", arxivCats: ["cs.MA","cs.GR"],
    wosCats: ["Computer Science, Interdisciplinary Applications","Computer Science, Information Systems"],
    conf: { ccf_a: ["ACM MM","SIGGRAPH","WWW","IEEE VIS"], ccf_b: ["ICWSM","CogSci","WINE","MICCAI","I3D","Eurographics","EuroVis"], ccf_c: ["3DV","ISMIR","PacificVis"] },
    jour: { ccf_a: ["TOG","TMM","TVCG","Proc. IEEE"], ccf_b: ["TCSVT","CAGD","CGF","CAD"], ccf_c: [], cas_1: ["ACM Transactions on Graphics","IEEE Transactions on Visualization and Computer Graphics"], cas_2: ["IEEE Transactions on Multimedia","Computers & Graphics"] },
  },
  bio: {
    label: "生物信息", arxivCats: ["q-bio.QM","q-bio.BM","q-bio.GN","q-bio.NC"],
    wosCats: ["Mathematical & Computational Biology","Biochemistry & Molecular Biology","Biotechnology & Applied Microbiology"],
    conf: { ccf_a: [], ccf_b: ["ISMB","RECOMB","BIBM","MICCAI"], ccf_c: ["APBC","ISBRA"] },
    jour: { ccf_a: ["Bioinformatics"], ccf_b: ["TCBB","JAMIA"], ccf_c: ["BMC Bioinformatics","Briefings in Bioinformatics"], cas_1: ["Nature Methods","Nucleic Acids Research","Genome Research","PLOS Computational Biology","Bioinformatics"], cas_2: ["BMC Bioinformatics","Briefings in Bioinformatics","Genomics"] },
  },
  math: {
    label: "数学", arxivCats: ["math.OC","math.NA","math.PR","math.ST","math.CO"],
    wosCats: ["Mathematics","Mathematics, Applied","Statistics & Probability"],
    conf: { ccf_a: [], ccf_b: [], ccf_c: [] },
    jour: { ccf_a: [], ccf_b: [], ccf_c: [], cas_1: ["Annals of Mathematics","Journal of the AMS","Inventiones Mathematicae","Acta Mathematica","SIAM Journal on Numerical Analysis","Foundations of Computational Mathematics"], cas_2: ["Mathematics of Computation","Numerische Mathematik","Journal of Differential Equations","SIAM Journal on Optimization"] },
  },
  physics: {
    label: "物理", arxivCats: ["physics.comp-ph","cond-mat","quant-ph","physics.app-ph"],
    wosCats: ["Physics, Multidisciplinary","Physics, Applied","Physics, Condensed Matter","Quantum Science & Technology"],
    conf: { ccf_a: [], ccf_b: [], ccf_c: [] },
    jour: { ccf_a: [], ccf_b: [], ccf_c: [], cas_1: ["Physical Review Letters","Nature Physics","Physical Review X","npj Quantum Information","Physical Review Materials"], cas_2: ["Physical Review B","Physical Review E","Journal of Physics: Condensed Matter"] },
  },
  ee: {
    label: "电气工程", arxivCats: ["eess.SP","eess.SY","eess.AS"],
    wosCats: ["Engineering, Electrical & Electronic","Instruments & Instrumentation","Energy & Fuels"],
    conf: { ccf_a: ["DAC","RTSS"], ccf_b: ["DATE","RTAS","EMSOFT","ISCAS"], ccf_c: ["ICCAD","ICCD","ISLPED"] },
    jour: { ccf_a: ["TCAD","TC"], ccf_b: ["TODAES","TECS","TRETS","TVLSI"], ccf_c: ["Integration"], cas_1: ["IEEE Transactions on Industrial Electronics","IEEE Transactions on Power Electronics","IEEE Signal Processing Letters","IEEE Transactions on Circuits and Systems I"], cas_2: ["Signal Processing","Digital Signal Processing","IEEE Transactions on Circuits and Systems II"] },
  },
  robotics: {
    label: "机器人", arxivCats: ["cs.RO","eess.SY"],
    wosCats: ["Robotics","Automation & Control Systems"],
    conf: { ccf_a: [], ccf_b: ["ICRA","IROS"], ccf_c: ["ICAR","Humanoids","CoRL"] },
    jour: { ccf_a: [], ccf_b: ["TAC"], ccf_c: ["Robotics and Autonomous Systems"], cas_1: ["Science Robotics","IEEE Transactions on Robotics","International Journal of Robotics Research","T-RO"], cas_2: ["Autonomous Robots","Journal of Field Robotics","Robotics and Autonomous Systems"] },
  },
};

export const RANK_OPTIONS = [
  { key: "ccf_a", label: "CCF-A", color: "#FF3B30", dynamic: false },
  { key: "ccf_b", label: "CCF-B", color: "#FF9500", dynamic: false },
  { key: "ccf_c", label: "CCF-C", color: "#8E8E93", dynamic: false },
  { key: "cas_1", label: "中科院1区", color: "#34C759", dynamic: false },
  { key: "cas_2", label: "中科院2区", color: "#30B0C7", dynamic: false },
  { key: "cas_3", label: "中科院3区", color: "#5AC8FA", dynamic: true },
  { key: "cas_4", label: "中科院4区", color: "#636366", dynamic: true },
  { key: "cas_top", label: "Top期刊", color: "#AF52DE", dynamic: true },
  { key: "jcr_q1", label: "JCR Q1", color: "#FF6B35", dynamic: true },
  { key: "jcr_q2", label: "JCR Q2", color: "#FF9F1C", dynamic: true },
  { key: "jcr_q3", label: "JCR Q3", color: "#A8DADC", dynamic: true },
  { key: "scie", label: "SCIE", color: "#4ECDC4", dynamic: true },
  { key: "ssci", label: "SSCI", color: "#96CEB4", dynamic: true },
] as const;

export type RankKey = (typeof RANK_OPTIONS)[number]["key"];

export function computeStaticVenues(
  domains: string[],
  type: "all" | "conference" | "journal",
  ranks: RankKey[],
): { categories: string[]; journalTerms: string[] } {
  const cats = new Set<string>();
  const terms = new Set<string>();
  const staticRanks = ranks.filter((rank) => !RANK_OPTIONS.find((option) => option.key === rank)?.dynamic);

  for (const domainKey of domains) {
    const domain = DOMAIN_VENUES[domainKey];
    if (!domain) continue;
    domain.arxivCats.forEach((category) => cats.add(category));
    const addConference = type === "all" || type === "conference";
    const addJournal = type === "all" || type === "journal";
    for (const rank of staticRanks) {
      if (addConference && rank in domain.conf) (domain.conf as Record<string, string[]>)[rank]?.forEach((venue) => terms.add(venue));
      if (addJournal && rank in domain.jour) (domain.jour as Record<string, string[]>)[rank]?.forEach((venue) => terms.add(venue));
    }
  }

  return { categories: [...cats], journalTerms: [...terms] };
}

export const CS_GROUPS: Array<{ label: string; keys: string[] }> = [
  { label: "人工智能", keys: ["ai", "cv", "nlp"] },
  { label: "数据与信息", keys: ["db"] },
  { label: "系统与工程", keys: ["sys", "se", "net"] },
  { label: "安全与理论", keys: ["sec", "theory"] },
  { label: "人机与多媒体", keys: ["hci", "cross"] },
];

export const NON_CS_KEYS = ["bio", "math", "physics", "ee", "robotics"];

export function splitStructuredInput(value: string) {
  const seen = new Set<string>();
  return value
    .split(/[，,；;\n]/)
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter((item) => {
      if (!item) return false;
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function hasStructuredArxivTerms(request: ArxivSearchRequest) {
  return Boolean(
    request.all_terms?.length ||
      request.title_terms?.length ||
      request.abstract_terms?.length ||
      request.authors?.length ||
      request.categories?.length ||
      request.comments_terms?.length ||
      request.journal_ref_terms?.length
  );
}

export function hasPaperDiscoveryCriteria(request: ArxivSearchRequest) {
  return Boolean(request.topic?.trim()) || hasStructuredArxivTerms(request);
}

export function buildWebSupplementQuery(request: ArxivSearchRequest) {
  return [
    request.topic,
    ...(request.all_terms ?? []),
    ...(request.title_terms ?? []),
    ...(request.abstract_terms ?? []),
    ...(request.authors ?? []),
    ...(request.categories ?? []),
    ...(request.comments_terms ?? []),
    ...(request.journal_ref_terms ?? []),
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(", ");
}

export function mergeWebSearchOutcomes(outcomes: WebSearchOutcome[]): WebSearchOutcome | null {
  if (outcomes.length === 0) return null;

  const providers = [...new Set(outcomes.map((outcome) => outcome.provider).filter(Boolean))];
  const answers = [...new Set(outcomes.map((outcome) => outcome.answer?.trim()).filter(Boolean))];
  const notes = [...new Set(outcomes.map((outcome) => outcome.note?.trim()).filter(Boolean))];
  const seen = new Set<string>();
  const items = outcomes.flatMap((outcome) => outcome.items).filter((item) => {
    const key = (item.url || item.title).trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    provider: providers.join(" + ") || "web",
    answer: answers.length > 0 ? answers.join("\n\n") : null,
    note: notes.length > 0 ? notes.join("；") : null,
    items,
  };
}

export function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDefaultCutoffDate(daysAgo = 0, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - Math.max(0, daysAgo));
  return formatDateInput(cutoff);
}

export function buildAppliedFilterEntries(filters?: ArxivSearchRequest | null, cutoffDate?: string) {
  if (!filters) return [];

  return [
    { label: "自然语言需求", values: filters.topic?.trim() ? [filters.topic.trim()] : [] },
    { label: "通用词(all)", values: filters.all_terms ?? [] },
    { label: "标题词(ti)", values: filters.title_terms ?? [] },
    { label: "摘要词(abs)", values: filters.abstract_terms ?? [] },
    { label: "作者(au)", values: filters.authors ?? [] },
    { label: "分类(cat)", values: filters.categories ?? [] },
    { label: "备注(co)", values: filters.comments_terms ?? [] },
    { label: "期刊/jr", values: filters.journal_ref_terms ?? [] },
    { label: "排除词", values: filters.exclude_terms ?? [] },
    { label: "截止日期", values: cutoffDate ? [cutoffDate] : [] },
  ].filter((entry) => entry.values.length > 0);
}

export function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function truncateText(value: string, maxChars = 280) {
  const normalized = value.trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}…`;
}

export function scoreVariant(score: number) {
  if (score >= 85) return "success" as const;
  if (score >= 70) return "info" as const;
  if (score >= 55) return "warning" as const;
  return "default" as const;
}

export function friendLinkSectionId(index: number) {
  return `yanweb-friend-links-${index + 1}`;
}

export function friendLinkInitial(value: string) {
  return value.trim().slice(0, 1) || "?";
}
