/**
 * Presentation vocabulary for acquisition phases: the UI's one mapping from the facade's phase
 * strings to human labels. Pure — shared by server loads and components, unit-tested in the node
 * project.
 */
export type BadgePhase = 'pending' | 'fulfilled' | 'failed';

export function phaseLabel(phase: BadgePhase): string {
  switch (phase) {
    case 'fulfilled':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'pending':
      return 'Working';
  }
}
