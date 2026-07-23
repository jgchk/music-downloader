import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  page: { error: null as { message: string; errorId?: string } | null },
}));
vi.mock('$app/state', () => mock);

const errorModule = await import('./+error.svelte');
const ErrorPage = errorModule.default;

describe('root error page (SSR)', () => {
  it('renders the error message and the id the user can quote', () => {
    mock.page.error = { message: 'The library is unreachable.', errorId: 'err-123' };
    const { body } = render(ErrorPage);
    expect(body).toContain('The library is unreachable.');
    expect(body).toContain('data-testid="error-id"');
    expect(body).toContain('err-123');
  });

  it('renders the message alone when no id was attached (an expected error, not a fault)', () => {
    mock.page.error = { message: 'No such acquisition.' };
    const { body } = render(ErrorPage);
    expect(body).toContain('No such acquisition.');
    expect(body).not.toContain('data-testid="error-id"');
  });
});
