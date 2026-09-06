// Human administration is unavailable in every deployed/production mode.
export function developmentAdminEnabled(mode) {
  return mode === 'development';
}
