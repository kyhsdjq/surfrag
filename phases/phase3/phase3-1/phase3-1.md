# Phase 3.1: Add LightRAG as Git Submodule

Add the LightRAG repository (via fork [kyhsdjq/LightRAG](https://github.com/kyhsdjq/LightRAG)) as a git submodule. This provides the LightRAG source in-tree for Phase 3 integration (see [phase3.md](../phase3.md)).

---

## Goal

- Add `git@github.com:kyhsdjq/LightRAG.git` as a git submodule.
- Place it at a path aligned with Phase 3 architecture (`services/lightrag/`).

---

## Plan

### 1. Add the submodule

```bash
git submodule add git@github.com:kyhsdjq/LightRAG.git services/lightrag
```

This will:
- Clone the LightRAG repo into `services/lightrag/`
- Create/update `.gitmodules` with the submodule mapping
- Stage the submodule reference for commit

### 2. Initialize and update (for fresh clones)

After adding, or when cloning the repo elsewhere:

```bash
git submodule update --init --recursive
```

### 3. Commit the change

```bash
git add .gitmodules services/lightrag
git commit -m "chore: add LightRAG as git submodule for Phase 3"
```

---

## Verification

- [ ] `services/lightrag/` exists and contains LightRAG repo files (e.g. `README.md`, `lightrag/` package).
- [ ] `.gitmodules` contains `[submodule "services/lightrag"]` with correct `path` and `url`.
- [ ] `git status` shows a clean working tree after commit.
- [ ] Cloning with `git clone --recurse-submodules` (or `git submodule update --init` after clone) populates `services/lightrag/`.

---

## Notes

- **Fork:** Using `git@github.com:kyhsdjq/LightRAG.git` (SSH). Ensure SSH keys are configured for GitHub.
- **Path choice:** `services/lightrag` matches the Phase 3 architecture (`services/lightrag/` for LightRAG setup).
- **Branch/tag:** By default, submodule tracks the remote default branch. To pin a release later: `git submodule set-branch --branch v1.x services/lightrag` (or use a commit SHA).
- **Downstream clones:** Document in main README that submodules must be initialized (`git clone --recurse-submodules` or `git submodule update --init`).

---

## Outputs

- [ ] `.gitmodules` — submodule configuration
- [ ] `services/lightrag/` — LightRAG source (submodule working tree)
- [ ] README update (optional) — note submodule usage for contributors
