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
    birth_date: string;
    address: string;
    phone: string;
    email: string;
  };
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

function renderResumeHtml(data: ResumeData, css: string): string {
  const links = (data.links ?? [])
    .map((link) => `<li><span>${escapeHtml(link.label)}</span><a href="${escapeHtml(link.url)}">${escapeHtml(link.url)}</a></li>`)
    .join("");

  const education = data.education
    .map((item) => `<li><time>${escapeHtml(item.date)}</time><p>${escapeHtml(item.description)}</p></li>`)
    .join("");

  const employment = data.employment_summary
    .map((item) => `<li><time>${escapeHtml(item.date)}</time><p>${escapeHtml(item.description)}</p></li>`)
    .join("");

  const licenses = data.licenses
    .map((item) => `<li><time>${escapeHtml(item.date)}</time><p>${escapeHtml(item.name)}</p></li>`)
    .join("");

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>${css}</style>
    <title>履歴書</title>
  </head>
  <body class="resume">
    <main>
      <header>
        <p class="eyebrow">Resume</p>
        <h1>履歴書</h1>
      </header>

      <section>
        <h2>基本情報</h2>
        <div class="grid">
          <p><strong>氏名</strong><span>${escapeHtml(data.personal.full_name)}</span></p>
          <p><strong>生年月日</strong><span>${escapeHtml(data.personal.birth_date)}</span></p>
          <p><strong>住所</strong><span>${escapeHtml(data.personal.address)}</span></p>
          <p><strong>電話</strong><span>${escapeHtml(data.personal.phone)}</span></p>
          <p><strong>メール</strong><span>${escapeHtml(data.personal.email)}</span></p>
        </div>
      </section>

      <section>
        <h2>学歴</h2>
        <ul class="timeline">${education}</ul>
      </section>

      <section>
        <h2>職歴</h2>
        <ul class="timeline">${employment}</ul>
      </section>

      <section>
        <h2>免許・資格</h2>
        <ul class="timeline">${licenses}</ul>
      </section>

      <section>
        <h2>リンク</h2>
        <ul class="links">${links}</ul>
      </section>

      <section>
        <h2>本人希望</h2>
        <p>${escapeHtml(data.preferences)}</p>
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
          if (project.responsibilities) {
            rows.push(`<p><strong>担当</strong><span>${escapeHtml(project.responsibilities.join(" / "))}</span></p>`);
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

async function convert(profile: string, outputDir: string): Promise<void> {
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

  const targetDir = path.join(outputDir, profile);
  fs.mkdirSync(targetDir, { recursive: true });

  await savePdfFromHtml(
    renderResumeHtml(resumeData as ResumeData, resumeCss),
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
    .strict()
    .parseAsync();

  const args: CliArgs = {
    profile: argv.profile,
    outputDir: path.resolve(argv["output-dir"]),
  };

  try {
    await convert(args.profile, args.outputDir);
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
