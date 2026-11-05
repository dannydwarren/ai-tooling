export function savedOk(body) {
    if (!body || typeof body !== 'object') {
        return 'no JSON body';
    }
    if ('IsSuccess' in body && body.IsSuccess !== true) {
        return `IsSuccess ${body.IsSuccess}: ${body.Message ?? ''}`;
    }
    return true;
}

export function first(body) {
    return Array.isArray(body) ? body[0] : body;
}
