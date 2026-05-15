export class MathUtils {
	public static sum(numbers: number[]): number {
		return numbers.reduce((acc, value) => acc + value, 0);
	}

	public static clamp(input: number, min: number, max: number): number {
		return Math.min(Math.max(input, min), max);
	}

	public static range(start: number, size: number): number[] {
		return Array.from({ length: size }, (_, index) => index + start);
	}

	public static ceilToMultiple(input: number, multiple: number): number {
		return Math.ceil(input / multiple) * multiple;
	}
}
