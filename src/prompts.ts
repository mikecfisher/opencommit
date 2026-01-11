import { note } from '@clack/prompts';
import { getConfig, getCustomPromptConfig, CustomPromptConfig } from './commands/config';
import { i18n, I18nLocals } from './i18n';
import { configureCommitlintIntegration } from './modules/commitlint/config';
import { commitlintPrompts } from './modules/commitlint/prompts';
import { ConsistencyPrompt } from './modules/commitlint/types';
import * as utils from './modules/commitlint/utils';
import { removeConventionalCommitWord } from './utils/removeConventionalCommitWord';
import {
  BreakingChangeHint,
  formatBreakingChangeHints
} from './utils/breakingChange';

interface Message {
  role: string;
  content: string;
}

const config = getConfig();
const translation = i18n[(config.OCO_LANGUAGE as I18nLocals) || 'en'];

export const IDENTITY =
  'You are to act as an author of a commit message in git.';

const GITMOJI_HELP = `Use GitMoji convention to preface the commit. Here are some help to choose the right emoji (emoji, description): 
🐛, Fix a bug; 
✨, Introduce new features; 
📝, Add or update documentation; 
🚀, Deploy stuff; 
✅, Add, update, or pass tests; 
♻️, Refactor code; 
⬆️, Upgrade dependencies; 
🔧, Add or update configuration files; 
🌐, Internationalization and localization; 
💡, Add or update comments in source code;`;

const FULL_GITMOJI_SPEC = `${GITMOJI_HELP}
🎨, Improve structure / format of the code; 
⚡️, Improve performance; 
🔥, Remove code or files; 
🚑️, Critical hotfix; 
💄, Add or update the UI and style files; 
🎉, Begin a project; 
🔒️, Fix security issues; 
🔐, Add or update secrets; 
🔖, Release / Version tags; 
🚨, Fix compiler / linter warnings; 
🚧, Work in progress; 
💚, Fix CI Build; 
⬇️, Downgrade dependencies; 
📌, Pin dependencies to specific versions; 
👷, Add or update CI build system; 
📈, Add or update analytics or track code; 
➕, Add a dependency; 
➖, Remove a dependency; 
🔨, Add or update development scripts; 
✏️, Fix typos; 
💩, Write bad code that needs to be improved; 
⏪️, Revert changes; 
🔀, Merge branches; 
📦️, Add or update compiled files or packages; 
👽️, Update code due to external API changes; 
🚚, Move or rename resources (e.g.: files, paths, routes); 
📄, Add or update license; 
💥, Introduce breaking changes; 
🍱, Add or update assets; 
♿️, Improve accessibility; 
🍻, Write code drunkenly; 
💬, Add or update text and literals; 
🗃️, Perform database related changes; 
🔊, Add or update logs; 
🔇, Remove logs; 
👥, Add or update contributor(s); 
🚸, Improve user experience / usability; 
🏗️, Make architectural changes; 
📱, Work on responsive design; 
🤡, Mock things; 
🥚, Add or update an easter egg; 
🙈, Add or update a .gitignore file; 
📸, Add or update snapshots; 
⚗️, Perform experiments; 
🔍️, Improve SEO; 
🏷️, Add or update types; 
🌱, Add or update seed files; 
🚩, Add, update, or remove feature flags; 
🥅, Catch errors; 
💫, Add or update animations and transitions; 
🗑️, Deprecate code that needs to be cleaned up; 
🛂, Work on code related to authorization, roles and permissions; 
🩹, Simple fix for a non-critical issue; 
🧐, Data exploration/inspection; 
⚰️, Remove dead code; 
🧪, Add a failing test; 
👔, Add or update business logic; 
🩺, Add or update healthcheck; 
🧱, Infrastructure related changes; 
🧑‍💻, Improve developer experience; 
💸, Add sponsorships or money related infrastructure; 
🧵, Add or update code related to multithreading or concurrency; 
🦺, Add or update code related to validation.`;

const CONVENTIONAL_COMMIT_KEYWORDS =
  'Do not preface the commit with anything, except for the conventional commit keywords: fix, feat, build, chore, ci, docs, style, refactor, perf, test.';

const COMMIT_FORMAT_INSTRUCTION = `
IMPORTANT: Output exactly ONE commit message. Follow this format strictly:

<type>(<optional scope>): <subject line>

<optional body with details>

Rules:
- The subject line must start with ONLY ONE type prefix (feat, fix, etc.)
- NEVER output multiple type prefixes (e.g., "feat: ... feat: ... refactor: ..." is WRONG)
- If there are multiple changes, use the most significant type for the subject
- List other changes as bullet points in the body using "- " prefix
- The body should be comprehensive - capture ALL significant changes
- Each bullet point should be a complete thought, not a commit-style prefix

Example for multiple changes:
feat: add user authentication and improve performance

- Add JWT-based authentication system with refresh tokens
- Implement rate limiting middleware for API endpoints  
- Update database schema to support user sessions
- Refactor connection pooling for better performance
- Fix memory leak in WebSocket handler
`;

const getCommitConvention = (fullGitMojiSpec: boolean) =>
  config.OCO_EMOJI
    ? fullGitMojiSpec
      ? FULL_GITMOJI_SPEC
      : GITMOJI_HELP
    : CONVENTIONAL_COMMIT_KEYWORDS;

const getDescriptionInstruction = () =>
  config.OCO_DESCRIPTION
    ? 'Add a short description of WHY the changes are done after the commit message. Don\'t start it with "This commit", just describe the changes.'
    : "Don't add any descriptions to the commit, only commit message.";

const getOneLineCommitInstruction = () =>
  config.OCO_ONE_LINE_COMMIT
    ? 'Craft a concise, single sentence, commit message that encapsulates all changes made, with an emphasis on the primary updates. If the modifications share a common theme or scope, mention it succinctly; otherwise, leave the scope out to maintain focus. The goal is to provide a clear and unified overview of the changes in one single message.'
    : '';

const getScopeInstruction = () =>
  config.OCO_OMIT_SCOPE
    ? 'Do not include a scope in the commit message format. Use the format: <type>: <subject>'
    : '';

const BREAKING_CHANGE_INSTRUCTION = `
BREAKING CHANGES: If the diff contains breaking changes (removed public APIs, changed function signatures, removed exports, renamed public interfaces, or other backwards-incompatible changes), you MUST:
1. Use an exclamation mark after the type/scope (e.g., "feat!:" or "refactor(api)!:")
2. Add a "BREAKING CHANGE:" footer at the end of the commit message explaining what breaks and how to migrate

Examples of breaking changes to look for:
- Removed or renamed exported functions, classes, types, or interfaces
- Changed function parameters (removed, reordered, or type changes)
- Changed return types
- Removed configuration options
- Changed default values that affect behavior
- Removed API endpoints or routes

Format for breaking change commits:
<type>(<scope>)!: <subject>

<optional body>

BREAKING CHANGE: <description of what breaks and migration path>
`;

const getBreakingChangeInstruction = () =>
  config.OCO_BREAKING_CHANGE ? BREAKING_CHANGE_INSTRUCTION : '';

/**
 * Get the context of the user input
 * @param extraArgs - The arguments passed to the command line
 * @example
 *  $ oco -- This is a context used to generate the commit message
 * @returns - The context of the user input
 */
const userInputCodeContext = (context: string) => {
  if (context !== '' && context !== ' ') {
    return `Additional context provided by the user: <context>${context}</context>\nConsider this context when generating the commit message, incorporating relevant information when appropriate.`;
  }
  return '';
};

const formatCustomInstructions = (customPrompt?: CustomPromptConfig): string => {
  if (!customPrompt?.instructions?.length) return '';
  return `\n\nProject-specific instructions:\n${customPrompt.instructions.map(i => `- ${i}`).join('\n')}`;
};

const INIT_MAIN_PROMPT = (
  language: string,
  fullGitMojiSpec: boolean,
  context: string,
  breakingChangeHints: string = '',
  customPrompt?: CustomPromptConfig,
  useGraphite: boolean = false
): Message => ({
  role: 'system',
  content: (() => {
    // If system prompt override is provided, use it instead of the default
    if (customPrompt?.systemPromptOverride) {
      return customPrompt.systemPromptOverride + formatCustomInstructions(customPrompt);
    }

    const commitConvention = fullGitMojiSpec
      ? 'GitMoji specification'
      : 'Conventional Commit Convention';
    const missionStatement = `${IDENTITY} Your mission is to create clean and comprehensive commit messages as per the ${commitConvention} and explain WHAT were the changes and mainly WHY the changes were done.`;
    const diffInstruction =
      "I'll send you an output of 'git diff --staged' command, and you are to convert it into a commit message.";
    const conventionGuidelines = getCommitConvention(fullGitMojiSpec);
    const descriptionGuideline = getDescriptionInstruction();
    const oneLineCommitGuideline = getOneLineCommitInstruction();
    const scopeInstruction = getScopeInstruction();
    const breakingChangeGuideline = getBreakingChangeInstruction();
    const generalGuidelines = `Use the present tense. Lines must not be longer than 74 characters. Use ${language} for the commit message.`;
    const graphiteInstruction = useGraphite
      ? '\n\nIMPORTANT FOR BRANCH NAME: The first line (subject) MUST be under 50 characters because it will be used to generate a branch name. Be extremely concise - prefer shorter words and abbreviations if needed.'
      : '';
    const userInputContext = userInputCodeContext(context);
    const customInstructions = formatCustomInstructions(customPrompt);

    return `${missionStatement}\n${diffInstruction}\n${conventionGuidelines}\n${COMMIT_FORMAT_INSTRUCTION}\n${descriptionGuideline}\n${oneLineCommitGuideline}\n${scopeInstruction}\n${breakingChangeGuideline}\n${generalGuidelines}${graphiteInstruction}\n${userInputContext}${breakingChangeHints}${customInstructions}`;
  })()
});

export const INIT_DIFF_PROMPT: Message = {
  role: 'user',
  content: `diff --git a/src/server.ts b/src/server.ts
    index ad4db42..f3b18a9 100644
    --- a/src/server.ts
    +++ b/src/server.ts
    @@ -10,7 +10,7 @@
    import {
        initWinstonLogger();
        
        const app = express();
        -const port = 7799;
        +const PORT = 7799;
        
        app.use(express.json());
        
        @@ -34,6 +34,6 @@
        app.use((_, res, next) => {
            // ROUTES
            app.use(PROTECTED_ROUTER_URL, protectedRouter);
            
            -app.listen(port, () => {
                -  console.log(\`Server listening on port \${port}\`);
                +app.listen(process.env.PORT || PORT, () => {
                    +  console.log(\`Server listening on port \${PORT}\`);
                });`
};

const COMMIT_TYPES = {
  fix: '🐛',
  feat: '✨'
} as const;

const generateCommitString = (
  type: keyof typeof COMMIT_TYPES,
  message: string
): string => {
  const cleanMessage = removeConventionalCommitWord(message);
  return config.OCO_EMOJI ? `${COMMIT_TYPES[type]} ${cleanMessage}` : message;
};

const getConsistencyContent = (translation: ConsistencyPrompt) => {
  const fixMessage =
    config.OCO_OMIT_SCOPE && translation.commitFixOmitScope
      ? translation.commitFixOmitScope
      : translation.commitFix;

  const featMessage =
    config.OCO_OMIT_SCOPE && translation.commitFeatOmitScope
      ? translation.commitFeatOmitScope
      : translation.commitFeat;

  const fix = generateCommitString('fix', fixMessage);
  const feat = config.OCO_ONE_LINE_COMMIT
    ? ''
    : generateCommitString('feat', featMessage);

  const description = config.OCO_DESCRIPTION
    ? translation.commitDescription
    : '';

  return [fix, feat, description].filter(Boolean).join('\n');
};

const INIT_CONSISTENCY_PROMPT = (translation: ConsistencyPrompt): Message => ({
  role: 'assistant',
  content: getConsistencyContent(translation)
});

export const getMainCommitPrompt = async (
  fullGitMojiSpec: boolean,
  context: string,
  breakingChangeHints: BreakingChangeHint[] = [],
  useGraphite: boolean = false
): Promise<Array<Message>> => {
  const hintsText = config.OCO_BREAKING_CHANGE
    ? formatBreakingChangeHints(breakingChangeHints)
    : '';

  // Get custom prompt config from .opencommit.jsonc
  const customPrompt = getCustomPromptConfig();

  switch (config.OCO_PROMPT_MODULE) {
    case '@commitlint':
      if (!(await utils.commitlintLLMConfigExists())) {
        note(
          `OCO_PROMPT_MODULE is @commitlint but you haven't generated consistency for this project yet.`
        );
        await configureCommitlintIntegration();
      }

      // Replace example prompt with a prompt that's generated by OpenAI for the commitlint config.
      const commitLintConfig = await utils.getCommitlintLLMConfig();

      return [
        commitlintPrompts.INIT_MAIN_PROMPT(
          translation.localLanguage,
          commitLintConfig.prompts,
          hintsText
        ),
        INIT_DIFF_PROMPT,
        INIT_CONSISTENCY_PROMPT(
          commitLintConfig.consistency[
            translation.localLanguage
          ] as ConsistencyPrompt
        )
      ];

    default:
      return [
        INIT_MAIN_PROMPT(
          translation.localLanguage,
          fullGitMojiSpec,
          context,
          hintsText,
          customPrompt,
          useGraphite
        ),
        INIT_DIFF_PROMPT,
        INIT_CONSISTENCY_PROMPT(translation)
      ];
  }
};
