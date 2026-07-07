/**
 * Project storage: a project is a folder of `<part>.cad.json` documents —
 * the "repo of parts" the AI copilot has full context over.
 */

import fs from "node:fs";
import path from "node:path";
import type { CadDocument } from "../src/kernel/types";
import { validateDocument } from "../src/kernel/validate";

const PROJECTS_DIR = path.resolve(process.cwd(), process.env.PROJECTS_DIR ?? "projects");

function safeName(name: string): string {
  if (!/^[A-Za-z0-9 _-]+$/.test(name)) {
    throw new Error(`Invalid name "${name}" (letters, digits, space, - and _ only)`);
  }
  return name;
}

export function projectsDir(): string {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  return PROJECTS_DIR;
}

export function listProjects(): string[] {
  return fs
    .readdirSync(projectsDir(), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export function createProject(name: string): void {
  fs.mkdirSync(path.join(projectsDir(), safeName(name)), { recursive: true });
}

function projectPath(project: string): string {
  const p = path.join(projectsDir(), safeName(project));
  if (!fs.existsSync(p)) throw new Error(`Project "${project}" not found`);
  return p;
}

function docPath(project: string, docName: string): string {
  return path.join(projectPath(project), `${safeName(docName)}.cad.json`);
}

export function listDocuments(project: string): string[] {
  return fs
    .readdirSync(projectPath(project))
    .filter((f) => f.endsWith(".cad.json"))
    .map((f) => f.slice(0, -".cad.json".length))
    .sort();
}

export function readDocument(project: string, docName: string): CadDocument {
  const p = docPath(project, docName);
  if (!fs.existsSync(p)) throw new Error(`Document "${docName}" not found in project "${project}"`);
  return JSON.parse(fs.readFileSync(p, "utf8")) as CadDocument;
}

export function writeDocument(project: string, docName: string, doc: CadDocument): void {
  const check = validateDocument(doc);
  if (!check.ok) throw new Error(`Invalid document: ${check.errors.join("; ")}`);
  fs.writeFileSync(docPath(project, docName), JSON.stringify(doc, null, 2));
}

export function deleteDocument(project: string, docName: string): void {
  const p = docPath(project, docName);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function documentExists(project: string, docName: string): boolean {
  try {
    return fs.existsSync(docPath(project, docName));
  } catch {
    return false;
  }
}
