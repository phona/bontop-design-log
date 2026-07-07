import { load } from 'js-yaml';
import designRulesRaw from '../../../config/design-rules.yaml?raw';

interface ObjectMappingRule {
  pattern: string;
  topics: string[];
}

interface DesignRules {
  objectMapping: ObjectMappingRule[];
}

const rules = load(designRulesRaw) as DesignRules;

export function getTopicsForObject(objectId: string): string[] {
  for (const rule of rules.objectMapping) {
    const prefix = rule.pattern.replace('*', '');
    if (objectId.startsWith(prefix) || objectId.includes(prefix.replace(':', ''))) {
      return rule.topics;
    }
  }
  return [];
}
