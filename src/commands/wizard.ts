import {
  intro,
  outro,
  select,
  text,
  multiselect,
  isCancel,
  cancel,
  note
} from '@clack/prompts';
import chalk from 'chalk';
import { command } from 'cleye';
import { COMMANDS } from './ENUMS';
import {
  MODEL_LIST,
  OCO_AI_PROVIDER_ENUM,
  CONFIG_KEYS,
  getConfig,
  setConfig,
  DEFAULT_TOKEN_LIMITS
} from './config';
import { i18n } from '../i18n';

// Provider display configuration
const PROVIDER_OPTIONS: Array<{
  value: OCO_AI_PROVIDER_ENUM;
  label: string;
  hint: string;
  requiresApiKey: boolean;
}> = [
  {
    value: OCO_AI_PROVIDER_ENUM.OPENAI,
    label: 'OpenAI',
    hint: 'GPT-4o, o3, o4-mini',
    requiresApiKey: true
  },
  {
    value: OCO_AI_PROVIDER_ENUM.ANTHROPIC,
    label: 'Anthropic',
    hint: 'Claude 3.5 Sonnet, Opus',
    requiresApiKey: true
  },
  {
    value: OCO_AI_PROVIDER_ENUM.GEMINI,
    label: 'Google (Gemini)',
    hint: 'Gemini 3 Flash, 2.5 Pro',
    requiresApiKey: true
  },
  {
    value: OCO_AI_PROVIDER_ENUM.AZURE,
    label: 'Azure OpenAI',
    hint: 'Azure-hosted OpenAI models',
    requiresApiKey: true
  },
  {
    value: OCO_AI_PROVIDER_ENUM.MISTRAL,
    label: 'Mistral',
    hint: 'Mistral Large, Codestral',
    requiresApiKey: true
  },
  {
    value: OCO_AI_PROVIDER_ENUM.GROQ,
    label: 'Groq',
    hint: 'Llama 3, Gemma (fast inference)',
    requiresApiKey: true
  },
  {
    value: OCO_AI_PROVIDER_ENUM.DEEPSEEK,
    label: 'DeepSeek',
    hint: 'DeepSeek Chat, Reasoner',
    requiresApiKey: true
  },
  {
    value: OCO_AI_PROVIDER_ENUM.OLLAMA,
    label: 'Ollama (local)',
    hint: 'Run models locally',
    requiresApiKey: false
  },
  {
    value: OCO_AI_PROVIDER_ENUM.MLX,
    label: 'MLX (local)',
    hint: 'Apple Silicon optimized',
    requiresApiKey: false
  },
  {
    value: OCO_AI_PROVIDER_ENUM.OPENROUTER,
    label: 'OpenRouter',
    hint: 'Access multiple providers',
    requiresApiKey: true
  },
  {
    value: OCO_AI_PROVIDER_ENUM.AIMLAPI,
    label: 'AI/ML API',
    hint: 'Unified AI API platform',
    requiresApiKey: true
  }
];

// Commit option configuration
const COMMIT_OPTIONS: Array<{
  value: CONFIG_KEYS;
  label: string;
  hint: string;
  defaultEnabled: boolean;
}> = [
  {
    value: CONFIG_KEYS.OCO_EMOJI,
    label: 'Add emoji (GitMoji)',
    hint: 'Prefix commits with relevant emoji',
    defaultEnabled: false
  },
  {
    value: CONFIG_KEYS.OCO_DESCRIPTION,
    label: 'Add description',
    hint: 'Add detailed description after commit message',
    defaultEnabled: false
  },
  {
    value: CONFIG_KEYS.OCO_ONE_LINE_COMMIT,
    label: 'One-line commits only',
    hint: 'Keep commit messages to a single line',
    defaultEnabled: false
  },
  {
    value: CONFIG_KEYS.OCO_OMIT_SCOPE,
    label: 'Omit scope',
    hint: 'Remove scope from conventional commits',
    defaultEnabled: false
  },
  {
    value: CONFIG_KEYS.OCO_BREAKING_CHANGE,
    label: 'Detect breaking changes',
    hint: 'Automatically flag breaking changes',
    defaultEnabled: true
  },
  {
    value: CONFIG_KEYS.OCO_WHY,
    label: 'Explain why',
    hint: 'Add explanation of why changes were made',
    defaultEnabled: false
  }
];

function getModelsForProvider(provider: OCO_AI_PROVIDER_ENUM): string[] {
  switch (provider) {
    case OCO_AI_PROVIDER_ENUM.OPENAI:
      return MODEL_LIST.openai;
    case OCO_AI_PROVIDER_ENUM.ANTHROPIC:
      return MODEL_LIST.anthropic;
    case OCO_AI_PROVIDER_ENUM.GEMINI:
      return MODEL_LIST.gemini;
    case OCO_AI_PROVIDER_ENUM.GROQ:
      return MODEL_LIST.groq;
    case OCO_AI_PROVIDER_ENUM.MISTRAL:
      return MODEL_LIST.mistral;
    case OCO_AI_PROVIDER_ENUM.DEEPSEEK:
      return MODEL_LIST.deepseek;
    case OCO_AI_PROVIDER_ENUM.AIMLAPI:
      return MODEL_LIST.aimlapi;
    case OCO_AI_PROVIDER_ENUM.OPENROUTER:
      return MODEL_LIST.openrouter;
    case OCO_AI_PROVIDER_ENUM.AZURE:
      return MODEL_LIST.openai; // Azure uses OpenAI models
    case OCO_AI_PROVIDER_ENUM.OLLAMA:
    case OCO_AI_PROVIDER_ENUM.MLX:
      return []; // User enters custom model name
    default:
      return [];
  }
}

function getDefaultModelForProvider(provider: OCO_AI_PROVIDER_ENUM): string {
  const models = getModelsForProvider(provider);
  return models[0] ?? '';
}

function getRecommendedTokenLimit(provider: OCO_AI_PROVIDER_ENUM): number {
  // Modern models have large context windows, recommend appropriate limits
  switch (provider) {
    case OCO_AI_PROVIDER_ENUM.GEMINI:
      return 128000; // Gemini models support 1M+ tokens
    case OCO_AI_PROVIDER_ENUM.ANTHROPIC:
      return 128000; // Claude supports 200K tokens
    case OCO_AI_PROVIDER_ENUM.OPENAI:
      return 128000; // GPT-4o supports 128K tokens
    case OCO_AI_PROVIDER_ENUM.DEEPSEEK:
      return 64000; // DeepSeek supports 64K tokens
    case OCO_AI_PROVIDER_ENUM.MISTRAL:
      return 32000; // Mistral models vary, 32K is safe
    case OCO_AI_PROVIDER_ENUM.GROQ:
      return 8192; // Groq has lower limits for speed
    case OCO_AI_PROVIDER_ENUM.OLLAMA:
    case OCO_AI_PROVIDER_ENUM.MLX:
      return 8192; // Local models vary, use conservative default
    default:
      return DEFAULT_TOKEN_LIMITS.DEFAULT_MAX_TOKENS_INPUT;
  }
}

function handleCancel(): never {
  cancel('Setup cancelled.');
  process.exit(0);
}

async function runSetupWizard(): Promise<void> {
  const currentConfig = getConfig();

  intro(chalk.bgCyan(chalk.black(' OpenCommit Setup Wizard ')));

  // Step 1: Provider selection
  const currentProvider =
    currentConfig.OCO_AI_PROVIDER ?? OCO_AI_PROVIDER_ENUM.OPENAI;

  const providerResult = await select({
    message: 'Which AI provider do you want to use?',
    options: PROVIDER_OPTIONS.map((p) => ({
      value: p.value,
      label: p.label,
      hint: currentProvider === p.value ? `${p.hint} (current)` : p.hint
    })),
    initialValue: currentProvider
  });

  if (isCancel(providerResult)) handleCancel();
  const provider = providerResult as OCO_AI_PROVIDER_ENUM;

  // Step 2: Model selection (text input with validation)
  const availableModels = getModelsForProvider(provider);
  const currentModel = currentConfig.OCO_MODEL ?? '';
  const defaultModel = getDefaultModelForProvider(provider);

  // Determine initial value - use current if it matches provider, otherwise use default
  const modelBelongsToProvider = availableModels.includes(currentModel);
  const initialModel = modelBelongsToProvider ? currentModel : defaultModel;

  let modelHint = '';
  if (availableModels.length > 0) {
    const topModels = availableModels.slice(0, 5);
    modelHint = `Available: ${topModels.join(', ')}${
      availableModels.length > 5 ? '...' : ''
    }`;
  } else {
    modelHint = 'Enter your model name (e.g., llama3.2)';
  }

  const modelResult = await text({
    message: 'Enter the model name:',
    placeholder: defaultModel || 'model-name',
    initialValue: initialModel,
    validate(value) {
      if (!value || value.trim().length === 0) {
        return 'Model name is required';
      }
      // For providers with predefined models, validate against the list
      if (
        availableModels.length > 0 &&
        !availableModels.includes(value.trim())
      ) {
        return `Unknown model. Available models include: ${availableModels
          .slice(0, 10)
          .join(', ')}${availableModels.length > 10 ? '...' : ''}`;
      }
      return undefined;
    }
  });

  if (isCancel(modelResult)) handleCancel();
  const model = (modelResult as string).trim();

  // Show hint after model selection
  if (modelHint) {
    note(modelHint, 'Model Info');
  }

  // Step 3: API Key (skip for local providers)
  const providerConfig = PROVIDER_OPTIONS.find((p) => p.value === provider);
  let apiKey = currentConfig.OCO_API_KEY ?? '';

  if (providerConfig?.requiresApiKey) {
    const apiKeyResult = await text({
      message: `Enter your ${providerConfig.label} API key:`,
      placeholder: 'sk-...',
      initialValue: apiKey,
      validate(value) {
        if (!value || value.trim().length === 0) {
          return 'API key is required for this provider';
        }
        if (value.trim().length < 10) {
          return 'API key seems too short';
        }
        return undefined;
      }
    });

    if (isCancel(apiKeyResult)) handleCancel();
    apiKey = (apiKeyResult as string).trim();
  }

  // Step 4: Commit message options
  const currentOptions = COMMIT_OPTIONS.filter((opt) => {
    const configValue = currentConfig[opt.value as keyof typeof currentConfig];
    // If config has a value, use it; otherwise use default
    return configValue !== undefined ? configValue : opt.defaultEnabled;
  }).map((opt) => opt.value);

  const optionsResult = await multiselect({
    message: 'Select commit message options:',
    options: COMMIT_OPTIONS.map((opt) => ({
      value: opt.value,
      label: opt.label,
      hint: opt.hint
    })),
    initialValues:
      currentOptions.length > 0
        ? currentOptions
        : COMMIT_OPTIONS.filter((o) => o.defaultEnabled).map((o) => o.value),
    required: false
  });

  if (isCancel(optionsResult)) handleCancel();
  const selectedOptions = optionsResult as CONFIG_KEYS[];

  // Step 5: Language selection
  const languages = Object.keys(i18n);
  const currentLanguage = currentConfig.OCO_LANGUAGE ?? 'en';

  const languageResult = await select({
    message: 'Select language for commit messages:',
    options: languages.map((lang) => ({
      value: lang,
      label: getLanguageLabel(lang),
      hint: currentLanguage === lang ? '(current)' : undefined
    })),
    initialValue: currentLanguage
  });

  if (isCancel(languageResult)) handleCancel();
  const language = languageResult as string;

  // Step 6: Token limit recommendation
  const recommendedTokenLimit = getRecommendedTokenLimit(provider);
  const currentTokenLimit =
    currentConfig.OCO_TOKENS_MAX_INPUT ??
    DEFAULT_TOKEN_LIMITS.DEFAULT_MAX_TOKENS_INPUT;

  // Only prompt if current limit is lower than recommended
  let tokenLimit = currentTokenLimit;
  if (currentTokenLimit < recommendedTokenLimit) {
    note(
      `Your current token limit (${currentTokenLimit}) is lower than recommended for ${provider}.\n` +
        `Higher limits allow processing larger diffs in a single request, which is faster.`,
      'Performance Tip'
    );

    const tokenResult = await select({
      message: 'Set token limit for input context:',
      options: [
        {
          value: recommendedTokenLimit,
          label: `${recommendedTokenLimit.toLocaleString()} (recommended for ${provider})`,
          hint: 'Faster for large diffs'
        },
        {
          value: currentTokenLimit,
          label: `${currentTokenLimit.toLocaleString()} (current)`,
          hint: 'Keep existing setting'
        },
        {
          value: DEFAULT_TOKEN_LIMITS.DEFAULT_MAX_TOKENS_INPUT,
          label: `${DEFAULT_TOKEN_LIMITS.DEFAULT_MAX_TOKENS_INPUT.toLocaleString()} (default)`,
          hint: 'Conservative default'
        }
      ],
      initialValue: recommendedTokenLimit
    });

    if (isCancel(tokenResult)) handleCancel();
    tokenLimit = tokenResult as number;
  }

  // Build config to save
  const configToSave: Array<[string, string | boolean | number | null]> = [
    [CONFIG_KEYS.OCO_AI_PROVIDER, provider],
    [CONFIG_KEYS.OCO_MODEL, model],
    [CONFIG_KEYS.OCO_LANGUAGE, language],
    [CONFIG_KEYS.OCO_TOKENS_MAX_INPUT, tokenLimit]
  ];

  if (apiKey) {
    configToSave.push([CONFIG_KEYS.OCO_API_KEY, apiKey]);
  }

  // Set boolean options
  for (const opt of COMMIT_OPTIONS) {
    const isEnabled = selectedOptions.includes(opt.value);
    configToSave.push([opt.value, isEnabled]);
  }

  // Save configuration
  try {
    setConfig(configToSave);
  } catch (error) {
    const err = error as Error;
    outro(chalk.red(`Failed to save configuration: ${err.message}`));
    process.exit(1);
  }

  // Display summary
  const summaryLines = [
    `Provider:    ${chalk.cyan(provider)}`,
    `Model:       ${chalk.cyan(model)}`,
    `Language:    ${chalk.cyan(language)}`,
    '',
    ...COMMIT_OPTIONS.map((opt) => {
      const isEnabled = selectedOptions.includes(opt.value);
      const icon = isEnabled ? chalk.green('✓') : chalk.gray('✗');
      const label = isEnabled ? opt.label : chalk.gray(opt.label);
      return `${icon} ${label}`;
    })
  ];

  note(summaryLines.join('\n'), 'Your Configuration');

  outro(
    chalk.green('Setup complete! Run `oco` to generate your first commit.')
  );
}

function getLanguageLabel(code: string): string {
  const labels: Record<string, string> = {
    en: 'English',
    zh_CN: 'Chinese (Simplified)',
    zh_TW: 'Chinese (Traditional)',
    ja: 'Japanese',
    ko: 'Korean',
    cs: 'Czech',
    de: 'German',
    es_ES: 'Spanish',
    fr: 'French',
    id_ID: 'Indonesian',
    it: 'Italian',
    nl: 'Dutch',
    pl: 'Polish',
    pt_br: 'Portuguese (Brazil)',
    ru: 'Russian',
    sv: 'Swedish',
    th: 'Thai',
    tr: 'Turkish',
    vi_VN: 'Vietnamese'
  };
  return labels[code] ?? code;
}

export const setupCommand = command(
  {
    name: COMMANDS.setup,
    help: {
      description: 'Interactive setup wizard to configure OpenCommit'
    }
  },
  async () => {
    try {
      await runSetupWizard();
    } catch (error) {
      const err = error as Error;
      outro(chalk.red(`Setup failed: ${err.message}`));
      process.exit(1);
    }
  }
);
