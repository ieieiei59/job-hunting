import fs from "node:fs";
import path from "node:path";

import { ErrorObject } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import yaml from "js-yaml";
import puppeteer from "puppeteer";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

type ResumeData = {
  schema_version: number;
  personal: {
    full_name: string;
    furigana?: string;
    address_furigana?: string;
    birth_date: string;
    gender?: string;
    postal_code?: string;
    address: string;
    contact_postal_code?: string;
    contact_address?: string;
    phone: string;
    email: string;
  };
  motivation?: string;
  jis?: {
    commute_time?: string;
    dependents?: number;
    spouse?: "有" | "無";
    spouse_support_obligation?: "有" | "無";
  };
  photo?: string;
  links?: Array<{ label: string; url: string }>;
  education: Array<{ date: string; description: string }>;
  employment_summary: Array<{ date: string; description: string }>;
  licenses: Array<{ date: string; name: string }>;
  preferences: string;
};

type WorkHistoryData = {
  schema_version: number;
  profile_summary: string;
  skills: Record<string, string[]>;
  experiences: Array<{
    period: { from: string; to: string };
    company: string;
    role: string;
    projects: Array<{
      name?: string;
      domain?: string;
      team_size?: number;
      responsibilities?: string[];
      tech_stack?: string[];
      achievements?: string[];
    }>;
  }>;
};

type CliArgs = {
  profile: string;
  outputDir: string;
  resumePages: "one" | "two";
};

const ROOT_DIR = path.resolve(__dirname, "../../..");
const CONTENTS_DIR = path.join(ROOT_DIR, "contents");
const SCHEMAS_DIR = path.join(CONTENTS_DIR, "schemas");
const TEMPLATES_DIR = path.join(ROOT_DIR, "tools", "templates");

function readYaml(filePath: string): unknown {
  const source = fs.readFileSync(filePath, "utf-8");
  return yaml.load(source);
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined, source: string): string {
  if (!errors || errors.length === 0) {
    return "";
  }

  return errors
    .map((err) => {
      const field = err.instancePath || "<root>";
      return `- ${source} ${field}: ${err.message}`;
    })
    .join("\n");
}

function validateOrThrow(data: unknown, schemaPath: string, sourcePath: string): void {
  const schema = readYaml(schemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema as object);

  const valid = validate(data);
  if (!valid) {
    const details = formatAjvErrors(validate.errors, sourcePath);
    throw new Error(`Validation failed:\n${details}`);
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function loadCss(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

function formatJapaneseDate(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${y}年${m}月${d}日`;
}

function toWareki(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();

  if (y > 2019 || (y === 2019 && (m > 5 || (m === 5 && d >= 1)))) {
    return `令和${y - 2018}年`;
  }
  if (y > 1989 || (y === 1989 && (m > 1 || (m === 1 && d >= 8)))) {
    return `平成${y - 1988}年`;
  }
  return `昭和${y - 1925}年`;
}

function parseFlexibleDate(value: string): Date | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (iso.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const wareki = /^(令和|平成|昭和)(\d+)年(\d{1,2})月(\d{1,2})日$/;
  const matched = value.match(wareki);
  if (!matched) {
    return null;
  }

  const era = matched[1];
  const eraYear = Number(matched[2]);
  const month = Number(matched[3]);
  const day = Number(matched[4]);

  const baseYear = era === "令和" ? 2018 : era === "平成" ? 1988 : 1925;
  const year = baseYear + eraYear;
  const d = new Date(year, month - 1, day);
  return Number.isNaN(d.getTime()) ? null : d;
}

function calcAge(birthDate: string, today: Date): number | null {
  const birth = parseFlexibleDate(birthDate);
  if (!birth) {
    return null;
  }

  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  const dayDiff = today.getDate() - birth.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }
  return age;
}

function resolvePhotoDataUri(profileDir: string, photoPath: string | undefined): string | null {
  if (!photoPath) {
    return null;
  }

  const raw = photoPath.trim();
  if (!raw) {
    return null;
  }

  const candidates = path.isAbsolute(raw)
    ? [raw]
    : [
        path.resolve(profileDir, raw),
        path.resolve(ROOT_DIR, raw),
        path.resolve(CONTENTS_DIR, raw),
        path.resolve(CONTENTS_DIR, "assets", "images", raw),
      ];

  const absolute = candidates.find((candidate) => fs.existsSync(candidate));
  if (!absolute) {
    return null;
  }

  const ext = path.extname(absolute).toLowerCase();
  const mimeByExt: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  const mime = mimeByExt[ext];
  if (!mime) {
    return null;
  }

  const imageBin = fs.readFileSync(absolute);
  return `data:${mime};base64,${imageBin.toString("base64")}`;
}

function renderResumeHtml(
  data: ResumeData,
  css: string,
  photoDataUri: string | null,
  forceSecondPage: boolean,
): string {
  const links = (data.links ?? [])
    .map((link) => `${escapeHtml(link.label)}: ${escapeHtml(link.url)}`)
    .join(" / ");

  const educationRows = data.education
    .map(
      (item) =>
        `<tr><td class="date-cell">${escapeHtml(item.date)}</td><td>${escapeHtml(item.description)}</td></tr>`,
    )
    .join("");

  const employmentRows = data.employment_summary
    .map(
      (item) =>
        `<tr><td class="date-cell">${escapeHtml(item.date)}</td><td>${escapeHtml(item.description)}</td></tr>`,
    )
    .join("");

  const hasCurrentLine = data.employment_summary.some((item) => item.description.includes("現在に至る"));
  const currentLineRow = hasCurrentLine
    ? ""
    : '<tr><td class="date-cell"></td><td>現在に至る</td></tr>';

  const licenseRows = data.licenses
    .map(
      (item) => `<tr><td class="date-cell">${escapeHtml(item.date)}</td><td>${escapeHtml(item.name)}</td></tr>`,
    )
    .join("");

  const educationAndEmploymentRows = `
    <tr><th class="section-label" colspan="2">学歴</th></tr>
    ${educationRows}
    <tr><th class="section-label" colspan="2">職歴</th></tr>
    ${employmentRows}
    ${currentLineRow}
    <tr><td class="date-cell"></td><td class="end-row">以上</td></tr>
  `;

  const todayDate = new Date();
  const age = calcAge(data.personal.birth_date, todayDate);
  const ageText = age !== null ? `満 ${age} 歳` : "満  歳";
  const currentDateText = `${toWareki(todayDate)} ${formatJapaneseDate(todayDate)} 現在`;

  const motivation = data.motivation ?? "";
  const contactAddress = data.personal.contact_address ?? "同上";
  const addressFurigana = data.personal.address_furigana ?? "";
  const contactPostalCode = data.personal.contact_postal_code
    ? `〒${escapeHtml(data.personal.contact_postal_code)} `
    : "";
  const postalCode = data.personal.postal_code ? `〒${escapeHtml(data.personal.postal_code)} ` : "";
  const spouse = data.jis?.spouse ?? "無";
  const spouseSupport = data.jis?.spouse_support_obligation ?? "無";
  const dependents = data.jis?.dependents ?? 0;
  const commute = data.jis?.commute_time ?? "約  時間  分";
  const furigana = data.personal.furigana ?? "";
  const gender = data.personal.gender ?? "";
  const motivationSectionClass = forceSecondPage ? "resume-section page-break-before" : "resume-section";

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>${css}</style>
    <title>履歴書</title>
  </head>
  <body class="resume">
    <main class="sheet">
      <header class="sheet-header">
        <h1>履 歴 書</h1>
        <p class="created-at">${escapeHtml(currentDateText)}</p>
      </header>

      <table class="resume-table basic-table" aria-label="基本情報">
        <tbody>
          <tr>
            <th>ふりがな</th>
            <td colspan="3">${escapeHtml(furigana)}</td>
            <td class="photo-cell" rowspan="6">
              <div class="photo-frame">
                ${
                  photoDataUri
                    ? `<img src="${photoDataUri}" alt="証明写真" class="photo-image" />`
                    : '<div class="photo-placeholder">写真をはる位置<br />1. 縦 36〜40mm 横 24〜30mm<br />2. 本人単身胸から上<br />3. 裏面のりづけ</div>'
                }
              </div>
            </td>
          </tr>
          <tr>
            <th>氏名</th>
            <td colspan="3" class="name-cell">${escapeHtml(data.personal.full_name)}</td>
          </tr>
          <tr>
            <th>生年月日</th>
            <td>${escapeHtml(data.personal.birth_date)}<br />(${escapeHtml(ageText)})</td>
            <th>※性別</th>
            <td>${escapeHtml(gender)}</td>
          </tr>
          <tr>
            <th>現住所ふりがな</th>
            <td colspan="3">${escapeHtml(addressFurigana)}</td>
          </tr>
          <tr>
            <th>現住所</th>
            <td colspan="3">${postalCode}${escapeHtml(data.personal.address)}</td>
          </tr>
          <tr>
            <th>連絡先</th>
            <td colspan="3">${contactPostalCode}${escapeHtml(contactAddress)}</td>
          </tr>
          <tr>
            <th>電話</th>
            <td>${escapeHtml(data.personal.phone)}</td>
            <th>メール</th>
            <td colspan="2">${escapeHtml(data.personal.email)}</td>
          </tr>
        </tbody>
      </table>

      <section class="resume-section">
        <h2>学歴・職歴</h2>
        <table class="resume-table history-table">
          <colgroup>
            <col class="date-col" />
            <col />
          </colgroup>
          <tbody>${educationAndEmploymentRows}</tbody>
        </table>
      </section>

      <section class="resume-section">
        <h2>資格・免許</h2>
        <table class="resume-table history-table">
          <colgroup>
            <col class="date-col" />
            <col />
          </colgroup>
          <tbody>
            ${licenseRows}
            <tr><td class="date-cell"></td><td class="end-row">以上</td></tr>
          </tbody>
        </table>
      </section>

      <section class="${motivationSectionClass}">
        <h2>志望の動機、特技、好きな学科、アピールポイントなど</h2>
        <div class="free-text motivation">${escapeHtml(motivation)}</div>
      </section>

      <section class="resume-section">
        <table class="resume-table status-table">
          <tbody>
            <tr>
              <th>通勤時間</th>
              <td>${escapeHtml(commute)}</td>
              <th>扶養家族(配偶者を除く)</th>
              <td>${dependents} 人</td>
              <th>配偶者</th>
              <td>${escapeHtml(spouse)}</td>
              <th>配偶者の扶養義務</th>
              <td>${escapeHtml(spouseSupport)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="resume-section">
        <h2>本人希望記入欄（特に給料・職種・勤務時間・勤務地・その他について希望があれば記入）</h2>
        <div class="free-text">${escapeHtml(data.preferences)}</div>
      </section>

      <section class="resume-section">
        <h2>連絡先・リンク</h2>
        <div class="free-text">${links || "記載なし"}</div>
      </section>
    </main>
  </body>
</html>`;
}

function renderWorkHistoryHtml(data: WorkHistoryData, css: string): string {
  const skills = Object.entries(data.skills)
    .map(([category, values]) => {
      const tags = values.map((v) => `<li>${escapeHtml(v)}</li>`).join("");
      return `<article><h3>${escapeHtml(category)}</h3><ul class="tags">${tags}</ul></article>`;
    })
    .join("");

  const experiences = data.experiences
    .map((exp) => {
      const projects = exp.projects
        .map((project) => {
          const rows: string[] = [];
          if (project.domain) rows.push(`<p><strong>領域</strong><span>${escapeHtml(project.domain)}</span></p>`);
          if (project.team_size) rows.push(`<p><strong>体制</strong><span>${project.team_size}名</span></p>`);
          if (project.responsibilities?.length) {
            const responsibilityItems = project.responsibilities
              .map((item) => `<div>${escapeHtml(item)}</div>`)
              .join("");
            rows.push(
              `<div class="project-row responsibilities-row"><strong>担当</strong><div class="multiline-items">${responsibilityItems}</div></div>`,
            );
          }
          if (project.tech_stack) {
            rows.push(`<p><strong>技術</strong><span>${escapeHtml(project.tech_stack.join(", "))}</span></p>`);
          }
          if (project.achievements) {
            rows.push(`<p><strong>成果</strong><span>${escapeHtml(project.achievements.join(" / "))}</span></p>`);
          }

          return `<div class="project"><h4>${escapeHtml(project.name ?? "Project")}</h4>${rows.join("")}</div>`;
        })
        .join("");

      return `<article class="experience">
        <header>
          <h3>${escapeHtml(exp.company)} / ${escapeHtml(exp.role)}</h3>
          <p>${escapeHtml(exp.period.from)} - ${escapeHtml(exp.period.to)}</p>
        </header>
        ${projects}
      </article>`;
    })
    .join("");

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>${css}</style>
    <title>職務経歴書</title>
  </head>
  <body class="work-history">
    <main>
      <header>
        <p class="eyebrow">Career Summary</p>
        <h1>職務経歴書</h1>
      </header>

      <section>
        <h2>職務要約</h2>
        <p>${escapeHtml(data.profile_summary)}</p>
      </section>

      <section>
        <h2>スキル</h2>
        <div class="skill-grid">${skills}</div>
      </section>

      <section>
        <h2>職務経歴</h2>
        <div class="experience-list">${experiences}</div>
      </section>
    </main>
  </body>
</html>`;
}

async function savePdfFromHtml(html: string, outputFile: string): Promise<void> {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.emulateMediaType("print");
    await page.pdf({
      path: outputFile,
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
    });
  } finally {
    await browser.close();
  }
}

async function convert(
  profile: string,
  outputDir: string,
  options: { forceSecondPage: boolean },
): Promise<void> {
  const profileDir = path.join(CONTENTS_DIR, "profiles", profile);
  const resumeYaml = path.join(profileDir, "resume.yaml");
  const workYaml = path.join(profileDir, "work-history.yaml");

  const resumeSchema = path.join(SCHEMAS_DIR, "resume.schema.yaml");
  const workSchema = path.join(SCHEMAS_DIR, "work-history.schema.yaml");

  const resumeData = readYaml(resumeYaml);
  const workData = readYaml(workYaml);

  validateOrThrow(resumeData, resumeSchema, resumeYaml);
  validateOrThrow(workData, workSchema, workYaml);

  const resumeCss = loadCss(path.join(TEMPLATES_DIR, "resume", "style.css"));
  const workCss = loadCss(path.join(TEMPLATES_DIR, "work-history", "style.css"));
  const photoDataUri = resolvePhotoDataUri(profileDir, (resumeData as ResumeData).photo);
  if ((resumeData as ResumeData).photo && !photoDataUri) {
    console.warn(
      `Photo was specified but could not be loaded: ${(resumeData as ResumeData).photo}`,
    );
  }

  const targetDir = path.join(outputDir, profile);
  fs.mkdirSync(targetDir, { recursive: true });

  await savePdfFromHtml(
    renderResumeHtml(resumeData as ResumeData, resumeCss, photoDataUri, options.forceSecondPage),
    path.join(targetDir, "resume.pdf"),
  );

  await savePdfFromHtml(
    renderWorkHistoryHtml(workData as WorkHistoryData, workCss),
    path.join(targetDir, "work-history.pdf"),
  );
}

async function main(): Promise<number> {
  const argv = await yargs(hideBin(process.argv))
    .option("profile", {
      type: "string",
      default: "default",
      describe: "Profile name under contents/profiles",
    })
    .option("output-dir", {
      type: "string",
      default: path.join(ROOT_DIR, "tools", "output"),
      describe: "Output directory for generated PDFs",
    })
    .option("resume-pages", {
      type: "string",
      choices: ["one", "two"] as const,
      default: "one",
      describe: "Resume page mode: one=prefer one-page, two=force second-page split before motivation",
    })
    .strict()
    .parseAsync();

  const args: CliArgs = {
    profile: argv.profile,
    outputDir: path.resolve(argv["output-dir"]),
    resumePages: argv["resume-pages"] === "two" ? "two" : "one",
  };

  try {
    await convert(args.profile, args.outputDir, { forceSecondPage: args.resumePages === "two" });
    console.log(`Generated PDFs for profile '${args.profile}'`);
    return 0;
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    return 1;
  }
}

void main().then((code) => {
  process.exit(code);
});
