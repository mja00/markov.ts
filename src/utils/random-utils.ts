export class RandomUtils {
	public static intFromInterval(min: number, max: number): number {
		return Math.floor((Math.random() * (max - min + 1)) + min);
	}

	public static shuffle(input: any[]): any[] {
		for (let i = input.length - 1; i > 0; i--) {
			const randomIndex = Math.floor(Math.random() * (i + 1));
			[input[i], input[randomIndex]] = [input[randomIndex], input[i]];
		}
		return input;
	}
}
