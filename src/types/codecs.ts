export type Codecs = {
    rateCancels: string[];
};

export function validateRateCancels(codecs: Codecs, input: string[]): [boolean, string] {
    const invalid: string[] = [];

    for (const rate of input) {
        if (!codecs.rateCancels.includes(rate)) {
            invalid.push(rate);
        }
    }

    if (invalid.length > 0) {
        return [false, "Invalid rate cancels: " + invalid.join(", ")];
    }
    return [true, ""];
}