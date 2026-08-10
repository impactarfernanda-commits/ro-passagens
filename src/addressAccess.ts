export type AddressAccess = { isRh: boolean; canImport: boolean };

export const podeAcessarImportacaoEnderecos = (access: AddressAccess) =>
  access.isRh || access.canImport;

export const podeAcessarAreasGerais = (access: AddressAccess & { canViewAll: boolean }) =>
  access.canViewAll && (!access.isRh || access.canImport);
