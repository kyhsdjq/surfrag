# Build Env for Phases 1.1

## Prerequisites
- Node.js (Latest LTS recommended)
- pnpm (Recommended for Plasmo) or npm/yarn

## Project Initialization
Initialize a new Plasmo project with React and TypeScript:

```bash
pnpm create plasmo
# Follow the prompts to name your project (e.g., "surfrag-extension")
# cd surfrag-extension
```

## Dependencies

### Core
- `plasmo`: The framework core.
- `react`: UI library.
- `react-dom`: React DOM bindings.

### Utilities
- `@mozilla/readability`: For extracting main body text content (as mentioned in the plan).

### Dev Dependencies
- `typescript`: For type safety.
- `@types/react`: Type definitions for React.
- `@types/react-dom`: Type definitions for React DOM.
- `@types/chrome`: Type definitions for Chrome Extension API.

## Setup Steps
1.  Run the initialization command.
2.  Install `@mozilla/readability`:
    ```bash
    pnpm add @mozilla/readability
    ```
3.  Verify `tsconfig.json` is set up for React and strict mode.

## Running the Project

### Development Server
Start the development server with Hot Module Replacement (HMR):
```bash
pnpm dev
```

### Production Build
Build the extension for production:
```bash
pnpm build
```

### Loading in Chrome
1.  Open Chrome and navigate to `chrome://extensions`.
2.  Enable **Developer mode** (toggle in the top right).
3.  Click **Load unpacked**.
4.  Select the `build/chrome-mv3-dev` directory (for development) or `build/chrome-mv3-prod` (for production) inside your project folder.
