/** Base de los errores de negocio: la capa HTTP los traduce a códigos 4xx. */
export abstract class DomainError extends Error {
  abstract readonly httpStatus: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Datos de entrada que violan una regla del dominio (400). */
export class ValidationError extends DomainError {
  readonly httpStatus = 400;
}

/** Entidad referenciada que no existe (404 para recursos, 400 cuando viene en el payload). */
export class NotFoundError extends DomainError {
  readonly httpStatus: number;

  constructor(message: string, httpStatus = 404) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

/** El usuario autenticado no puede operar sobre el recurso (403). */
export class ForbiddenError extends DomainError {
  readonly httpStatus = 403;
}
