import type { CcfEntry } from "@research-copilot/types";

export type CcfRating = "A" | "B" | "C" | "none";

export interface VenueTemplate {
  id: string;
  name: string;
  fullName: string;
  type: "conference" | "journal";
  ccf: CcfRating;
  area: string;
  publisher?: string;
  sci?: boolean;
  sciQuartile?: "Q1" | "Q2" | "Q3" | "Q4";
  ei?: boolean;
  ccfci?: boolean;
  website?: string;
  deadline?: string;
  notificationDate?: string;
  conferenceDate?: string;
  conferenceLocation?: string;
  deadlineTimezone?: string;
  dataSource?: string;
}

interface CcfddlDeadlineMeta {
  website?: string;
  deadline?: string;
  notificationDate?: string;
  conferenceDate?: string;
  conferenceLocation?: string;
  deadlineTimezone?: string;
}

const CCFDDL_SOURCE_URL = "https://ccfddl.top/";

export const AREA_SHORT_NAMES: Record<string, string> = {
  "计算机体系结构/并行与分布计算/存储系统": "体系结构",
  "计算机网络": "网络",
  "网络与信息安全": "安全",
  "软件工程/系统软件/程序设计语言": "软件工程",
  "数据库/数据挖掘/内容检索": "数据库",
  "计算机科学理论": "理论",
  "计算机图形学与多媒体": "图形多媒体",
  "人工智能": "人工智能",
  "人机交互与普适计算": "人机交互",
  "交叉/综合/新兴": "交叉学科",
};

const CCFDDL_DEADLINE_OVERRIDES: Record<string, CcfddlDeadlineMeta> = {
  acl: {
    website: "https://2026.aclweb.org/",
    deadline: "2026-02-23",
    notificationDate: "2026-05-18",
    conferenceDate: "2026-07-05",
    conferenceLocation: "San Diego, USA",
    deadlineTimezone: "UTC-12",
  },
  icml: {
    website: "https://icml.cc/Conferences/2026",
    deadline: "2026-01-28",
    notificationDate: "2026-05-01",
    conferenceDate: "2026-07-12",
    conferenceLocation: "Seoul, South Korea",
    deadlineTimezone: "UTC-12",
  },
  iclr: {
    website: "https://iclr.cc/Conferences/2026",
    deadline: "2025-09-19",
    notificationDate: "2026-01-22",
    conferenceDate: "2026-04-23",
    conferenceLocation: "Rio de Janeiro, Brazil",
    deadlineTimezone: "UTC-12",
  },
  ijcai: {
    website: "https://2026.ijcai.org/",
    deadline: "2026-01-23",
    notificationDate: "2026-04-20",
    conferenceDate: "2026-08-15",
    conferenceLocation: "Bremen, Germany",
    deadlineTimezone: "UTC-12",
  },
  interspeech: {
    website: "https://www.interspeech2026.org/",
    deadline: "2026-03-27",
    notificationDate: "2026-06-22",
    conferenceDate: "2026-09-21",
    conferenceLocation: "Sydney, Australia",
    deadlineTimezone: "UTC-12",
  },
  iconip: {
    website: "https://www.apnns.org/iconip2026/",
    deadline: "2026-05-10",
    notificationDate: "2026-07-15",
    conferenceDate: "2026-11-20",
    conferenceLocation: "Singapore",
    deadlineTimezone: "UTC-12",
  },
  iccbr: {
    website: "https://iccbr2026.github.io/",
    deadline: "2026-04-24",
    notificationDate: "2026-06-01",
    conferenceDate: "2026-09-14",
    conferenceLocation: "Limassol, Cyprus",
    deadlineTimezone: "UTC-12",
  },
  ictai: {
    website: "https://ictai.computer.org/2026/",
    deadline: "2026-06-30",
    notificationDate: "2026-08-03",
    conferenceDate: "2026-10-26",
    conferenceLocation: "Taormina, Italy",
    deadlineTimezone: "UTC-12",
  },
  siggraph: {
    website: "https://s2026.siggraph.org/",
    deadline: "2026-01-22",
    notificationDate: "2026-04-30",
    conferenceDate: "2026-07-19",
    conferenceLocation: "Anaheim, USA",
    deadlineTimezone: "UTC-12",
  },
  siggraphasia: {
    website: "https://sa2026.siggraph.org/",
    deadline: "2026-05-20",
    notificationDate: "2026-07-27",
    conferenceDate: "2026-12-15",
    conferenceLocation: "Hong Kong, China",
    deadlineTimezone: "UTC-12",
  },
  vis: {
    website: "https://ieeevis.org/year/2026/welcome",
    deadline: "2026-03-31",
    notificationDate: "2026-06-15",
    conferenceDate: "2026-11-01",
    conferenceLocation: "Baltimore, USA",
    deadlineTimezone: "UTC-12",
  },
  cgf: {
    website: "https://cgf2026.github.io/",
    deadline: "2026-01-15",
    notificationDate: "2026-03-01",
    conferenceDate: "2026-06-01",
    conferenceLocation: "Nanjing, China",
    deadlineTimezone: "UTC-12",
  },
};

export const POPULAR_VENUES: VenueTemplate[] = [
  { id: "neurips", name: "NeurIPS", fullName: "Conference on Neural Information Processing Systems", type: "conference", ccf: "A", area: "人工智能", website: "https://neurips.cc" },
  { id: "icml", name: "ICML", fullName: "International Conference on Machine Learning", type: "conference", ccf: "A", area: "人工智能", website: "https://icml.cc/Conferences/2026", ...deadlineMetaToTemplate(CCFDDL_DEADLINE_OVERRIDES.icml) },
  { id: "iclr", name: "ICLR", fullName: "International Conference on Learning Representations", type: "conference", ccf: "A", area: "人工智能", website: "https://iclr.cc/Conferences/2026", ...deadlineMetaToTemplate(CCFDDL_DEADLINE_OVERRIDES.iclr) },
  { id: "cvpr", name: "CVPR", fullName: "IEEE/CVF Computer Vision and Pattern Recognition Conference", type: "conference", ccf: "A", area: "人工智能", website: "https://cvpr.thecvf.com" },
  { id: "acl", name: "ACL", fullName: "Annual Meeting of the Association for Computational Linguistics", type: "conference", ccf: "A", area: "人工智能", website: "https://2026.aclweb.org/", ...deadlineMetaToTemplate(CCFDDL_DEADLINE_OVERRIDES.acl) },
  { id: "sigmod", name: "SIGMOD", fullName: "ACM International Conference on Management of Data", type: "conference", ccf: "A", area: "数据库", website: "https://sigmod.org" },
  { id: "sigcomm", name: "SIGCOMM", fullName: "ACM Conference on Applications, Technologies, Architectures, and Protocols for Computer Communication", type: "conference", ccf: "A", area: "网络", website: "https://sigcomm.org" },
  { id: "ccs", name: "CCS", fullName: "ACM Conference on Computer and Communications Security", type: "conference", ccf: "A", area: "安全", website: "https://sigsac.org/ccs" },
  { id: "icse", name: "ICSE", fullName: "International Conference on Software Engineering", type: "conference", ccf: "A", area: "软件工程", website: "https://icse-conferences.org" },
  { id: "chi", name: "CHI", fullName: "ACM Conference on Human Factors in Computing Systems", type: "conference", ccf: "A", area: "人机交互", website: "https://sigchi.org/conferences/chi" },
  { id: "tpami", name: "TPAMI", fullName: "IEEE Transactions on Pattern Analysis and Machine Intelligence", type: "journal", ccf: "A", area: "人工智能", publisher: "IEEE", website: "https://ieeexplore.ieee.org/xpl/RecentIssue.jsp?punumber=34" },
  { id: "jacm", name: "JACM", fullName: "Journal of the ACM", type: "journal", ccf: "A", area: "理论", publisher: "ACM", website: "https://dl.acm.org/journal/jacm" },
];

export function buildVenueTemplatesFromCcfCatalog(entries: CcfEntry[]) {
  return entries
    .map(mapCcfEntryToVenueTemplate)
    .sort((left, right) => {
      const areaOrder = left.area.localeCompare(right.area, "zh-Hans");
      if (areaOrder !== 0) return areaOrder;
      const ratingOrder = ccfRatingRank(right.ccf) - ccfRatingRank(left.ccf);
      if (ratingOrder !== 0) return ratingOrder;
      const typeOrder = left.type.localeCompare(right.type);
      if (typeOrder !== 0) return typeOrder;
      return left.name.localeCompare(right.name);
    });
}

export function mapCcfEntryToVenueTemplate(entry: CcfEntry): VenueTemplate {
  const type = entry.kind === "journal" ? "journal" : "conference";
  const venueKey = normalizeVenueKey(entry.label || entry.full_name);
  const override = CCFDDL_DEADLINE_OVERRIDES[venueKey];

  return {
    // CCF 目录中存在跨领域重名简称（如 TCC、CC、FSE）。使用复合标识，
    // 避免筛选列表时 React 因重复 key 复用错误的结果卡片。
    id: `${type}:${entry.area}:${venueKey}:${normalizeVenueKey(entry.full_name)}`,
    name: entry.label,
    fullName: entry.full_name,
    type,
    ccf: normalizeCcfRating(entry.rating),
    area: areaDisplayName(entry.area),
    publisher: entry.publisher || undefined,
    website: override?.website ?? normalizeWebsite(entry.url),
    ...deadlineMetaToTemplate(override),
  };
}

export function getAllAreas(venues: VenueTemplate[] = POPULAR_VENUES): string[] {
  return [...new Set(venues.map((venue) => venue.area))].sort((left, right) => left.localeCompare(right, "zh-Hans"));
}

export function getVenuesByArea(venues: VenueTemplate[] = POPULAR_VENUES): Record<string, VenueTemplate[]> {
  return venues.reduce<Record<string, VenueTemplate[]>>((result, venue) => {
    result[venue.area] = [...(result[venue.area] ?? []), venue];
    return result;
  }, {});
}

export function filterVenueTemplates({
  area,
  query,
  templates,
  type,
}: {
  area: string;
  query: string;
  templates: VenueTemplate[];
  type: "all" | "conference" | "journal";
}) {
  const queryTerms = normalizeVenueSearchText(query).split(" ").filter(Boolean);

  return templates.filter((venue) => {
    const searchableText = normalizeVenueSearchText([
      venue.name,
      venue.fullName,
      venue.area,
      venue.publisher,
      venue.ccf === "none" ? undefined : `CCF ${venue.ccf}`,
      venue.type === "conference" ? "会议 conference" : "期刊 journal",
    ].filter(Boolean).join(" "));
    const compactSearchableText = searchableText.replaceAll(" ", "");
    const matchesQuery = queryTerms.every((term) => (
      searchableText.includes(term) || compactSearchableText.includes(term.replaceAll(" ", ""))
    ));
    const matchesArea = area === "all" || venue.area === area;
    const matchesType = type === "all" || venue.type === type;
    return matchesQuery && matchesArea && matchesType;
  });
}

export function getVenueTemplateDates(template: VenueTemplate) {
  return {
    deadline: normalizeIsoDate(template.deadline),
    notificationDate: normalizeIsoDate(template.notificationDate),
  };
}

export function normalizeVenueKey(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeVenueSearchText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[\s\-_/，,。.、:：;；()（）[\]【】]+/g, " ")
    .trim();
}

function areaDisplayName(area: string) {
  return AREA_SHORT_NAMES[area] ?? area;
}

function normalizeCcfRating(rating: string): CcfRating {
  return rating === "A" || rating === "B" || rating === "C" ? rating : "none";
}

function normalizeWebsite(url: string) {
  return url?.trim() || undefined;
}

function normalizeIsoDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return value;
}

function deadlineMetaToTemplate(meta?: CcfddlDeadlineMeta): Partial<VenueTemplate> {
  if (!meta) return {};
  return {
    deadline: normalizeIsoDate(meta.deadline),
    notificationDate: normalizeIsoDate(meta.notificationDate),
    conferenceDate: normalizeIsoDate(meta.conferenceDate),
    conferenceLocation: meta.conferenceLocation,
    deadlineTimezone: meta.deadlineTimezone,
    dataSource: CCFDDL_SOURCE_URL,
  };
}

function ccfRatingRank(rating: CcfRating) {
  if (rating === "A") return 3;
  if (rating === "B") return 2;
  if (rating === "C") return 1;
  return 0;
}
