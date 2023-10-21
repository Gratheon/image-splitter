export const schema = `
scalar JSON
scalar DateTime
scalar Upload
scalar ID
scalar URL

type Query {
	file(id:ID!): File
	hiveFiles(hiveId:ID!): [FrameSideFile]
	hiveFrameSideFile(frameSideId:ID!): FrameSideFile
	hiveFrameSideCells(frameSideId:ID!): FrameSideCells
}

type Mutation {
	uploadFrameSide(file: Upload!): File
	addFileToFrameSide(frameSideId: ID!, fileId: ID!, hiveId: ID!): Boolean
	filesStrokeEditMutation(files: [FilesUpdateInput]): Boolean

	updateFrameSideCells(cells: FrameSideCellsInput!): Boolean!
}

input FilesUpdateInput{
	frameSideId: ID!
	fileId: ID!
	strokeHistory: JSON!
}

"""
FrameSideFile is an intermediate (join) entity that connects FrameSide with File
"""
type FrameSideFile {
	file: File!
	frameSideId: ID
	hiveId: ID
	strokeHistory: JSON

	detectedBees: JSON
	detectedQueenCount: Int
	detectedWorkerBeeCount: Int
	detectedDroneCount: Int
	isBeeDetectionComplete: Boolean

	detectedCells: JSON
	isCellsDetectionComplete: Boolean

	detectedQueenCups: JSON
	isQueenCupsDetectionComplete: Boolean

	queenDetected: Boolean!
  
	workerCount: Int
	droneCount: Int
}

"""
File is an abstraction of an uploaded photo of a frame
But we don't want to mix it with various properties in case we will have more uploads
for other purposes than for a frame. For example, hive bottom or hive entrance.
"""
type File{
	id: ID!
	url: URL!
	resizes: [FileResize]
}

type FileResize {
	id: ID!
	max_dimension_px: Int!
	url: URL!
}

"""
Frame has two sides - left and right
FrameSide is associated with an photo of it (file) and the contents (cells)
"""
extend type FrameSide @key(fields: "id") {
	id: ID @external
	file: File
	cells: FrameSideCells
}

extend type Hive @key(fields: "id") {
	id: ID! @external
	files: [FrameSideFile]
}

"""
Frame cells is a statistic information of FrameSide composition
"""
type FrameSideCells @key(fields: "id"){
	id: ID!
	
	broodPercent: Int
	cappedBroodPercent: Int
	eggsPercent: Int
	pollenPercent: Int
	honeyPercent: Int
}

"""
FrameSideCellsInput is used to update percentage composition of a FrameSide
This is useful if automatic detection was not correct and user wants to adjust percentages
"""
input FrameSideCellsInput{
	id: ID!
	
	broodPercent: Int
	cappedBroodPercent: Int
	eggsPercent: Int
	pollenPercent: Int
	honeyPercent: Int
}
`;
