export class NotFoundError extends Error {
  constructor(message = '찾을 수 없습니다.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadRequestError';
  }
}
