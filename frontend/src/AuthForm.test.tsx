import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AuthForm } from './AuthForm'

describe('AuthForm', () => {
  it('renders the login form with browser autofill hints', () => {
    const markup = renderToStaticMarkup(<AuthForm onSession={() => {}} />)

    expect(markup).toContain('Log in')
    expect(markup).toContain('autoComplete="username"')
    expect(markup).toContain('autoComplete="current-password"')
    expect(markup).toContain('type="password"')
    expect(markup).toContain('Create an account')
  })

  it('renders the signup form', () => {
    const markup = renderToStaticMarkup(<AuthForm onSession={() => {}} initialMode="signup" />)

    expect(markup).toContain('Sign up')
    expect(markup).toContain('autoComplete="new-password"')
  })

  it('shows why the user was sent back to log in', () => {
    const markup = renderToStaticMarkup(
      <AuthForm onSession={() => {}} notice="Your session expired. Log in again." />,
    )

    expect(markup).toContain('Your session expired. Log in again.')
  })
})
