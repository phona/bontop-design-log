export interface Pitfall {
  id: string;
  type: 'budget' | 'construction' | 'acceptance';
  stage: string;
  category: string;
  trigger: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  mitigation: string;
  checklist?: string[];
}

export interface BudgetTemplate {
  id: string;
  name: string;
  total: number;
  description: string;
  allocation: Record<string, number>;
}

export interface PitfallConfig {
  version: string;
  pitfalls: Pitfall[];
  templates: BudgetTemplate[];
}

export class PitfallEngine {
  private config: PitfallConfig;

  constructor(config: PitfallConfig) {
    this.config = config;
  }

  getPitfalls(opts?: { category?: string; type?: string; stage?: string }): Pitfall[] {
    return this.config.pitfalls.filter(
      (p) =>
        (!opts?.category || p.category === opts.category) &&
        (!opts?.type || p.type === opts.type) &&
        (!opts?.stage || p.stage === opts.stage)
    );
  }

  getTemplate(tier?: string, targetBudget?: number): BudgetTemplate | undefined {
    if (tier) {
      const found = this.config.templates.find((t) => t.id === tier);
      if (found) return found;
    }
    if (targetBudget) {
      return this.config.templates
        .filter((t) => t.total <= targetBudget)
        .sort((a, b) => b.total - a.total)[0];
    }
    return this.config.templates[0];
  }

  listTemplates(): BudgetTemplate[] {
    return this.config.templates;
  }
}
